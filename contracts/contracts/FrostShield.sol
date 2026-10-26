// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FrostShield
 * @notice Параметарско осигурување и јавен регистар на штети од доцни пролетни
 *         мразеви за раноградинарски култури (Струмичко-Гевгелиски регион).
 *
 *  Сè е на синџирот:
 *   - полисите на земјоделците (култура, тип на производство, регион, сезона, покритие);
 *   - мразните настани што ги пријавува оракулот (минимум, часови под 0 °C и -2 °C);
 *   - моделот за штета (критична температура и коефициенти по култура,
 *     заштитен фактор по тип на производство) – јавен и проверлив;
 *   - исплатите, кои се пресметуваат и извршуваат автоматски од договорот.
 *
 *  Температурите се чуваат во десетинки од степенот (int16): -2.5 °C = -25.
 *  Датумите се во формат YYYYMMDD (uint32): 15 март 2027 = 20270315.
 *  Штетата е во базни поени (bps): 10000 = 100 %.
 */
contract FrostShield is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant MODEL_ADMIN_ROLE = keccak256("MODEL_ADMIN_ROLE");

    uint8 public constant REGION_COUNT = 4; // 0 Струмица, 1 Гевгелија, 2 Валандово, 3 Богданци
    uint8 public constant CROP_COUNT = 4;   // 0 Домат, 1 Пипер, 2 Краставица, 3 Салата
    uint8 public constant PROD_COUNT = 3;   // 0 Отворено, 1 Нисок тунел, 2 Пластеник

    uint16 public constant BPS = 10_000;

    // ---------------- Модел за штета (параметри на синџирот) ----------------

    struct CropParams {
        int16 criticalTemp;      // десетинки °C, под оваа температура почнува штета
        uint16 bpsPerDegree;     // штета (bps) по секој степен под критичната температура
        uint16 bpsPerHourBelow0; // штета (bps) по секој час под 0 °C
        uint16 bpsPerHourBelowM2;// дополнителна штета (bps) по секој час под -2 °C
    }

    CropParams[CROP_COUNT] public cropParams;
    uint16[PROD_COUNT] public protectionBps; // колкав дел од штетата „минува“ низ заштитата

    uint16 public premiumRateBps = 500; // премија = 5 % од покритието

    /// Период на чекање: покриен е само мраз чиј датум е барем толку по купувањето.
    /// Спречува „осигурување на веќе изгорена градина“.
    uint32 public waitingPeriod = 3 days;

    // ---------------- Мразни настани ----------------

    struct FrostEvent {
        uint8 region;
        uint32 date;            // YYYYMMDD
        int16 minTemp;          // десетинки °C
        uint16 hoursBelow0;
        uint16 hoursBelowM2;
        bytes32 dataHash;       // хеш на суровите часовни податоци (за ревизија)
        uint64 reportedAt;
        address reporter;
    }

    FrostEvent[] public frostEvents;
    mapping(bytes32 => bool) public eventKeyUsed; // region+date -> веќе пријавен

    // ---------------- Полиси ----------------

    struct Policy {
        address farmer;
        uint8 region;
        uint8 crop;
        uint8 prodType;
        uint32 areaM2;          // површина во m²
        uint32 seasonStart;     // YYYYMMDD
        uint32 seasonEnd;       // YYYYMMDD
        uint256 coverage;       // максимална исплата (wei)
        uint256 premium;        // платена премија (wei)
        uint256 paidOut;        // досега исплатено (wei)
        uint64 createdAt;
    }

    Policy[] public policies;
    mapping(address => uint256[]) private _policiesOf;
    mapping(uint256 => mapping(uint256 => bool)) public claimed; // policyId => eventId => исплатено

    struct Claim {
        uint256 policyId;
        uint256 eventId;
        uint16 damageBps;
        uint256 amount;
        uint64 paidAt;
    }

    Claim[] public claims;

    uint256 public totalCoverageActive; // збир на неисплатено покритие (за проверка на ликвидност)

    // ---------------- Настани (logs) ----------------

    event PoolFunded(address indexed from, uint256 amount);
    event PoolWithdrawn(address indexed to, uint256 amount);
    event PolicyCreated(uint256 indexed policyId, address indexed farmer, uint8 region, uint8 crop, uint8 prodType, uint256 coverage, uint256 premium);
    event FrostReported(uint256 indexed eventId, uint8 indexed region, uint32 date, int16 minTemp, uint16 hoursBelow0, uint16 hoursBelowM2, bytes32 dataHash);
    event ClaimPaid(uint256 indexed claimId, uint256 indexed policyId, uint256 indexed eventId, uint16 damageBps, uint256 amount);
    event CropParamsUpdated(uint8 indexed crop, int16 criticalTemp, uint16 bpsPerDegree, uint16 bpsPerHourBelow0, uint16 bpsPerHourBelowM2);
    event ProtectionUpdated(uint8 indexed prodType, uint16 protectionBps);
    event PremiumRateUpdated(uint16 premiumRateBps);
    event WaitingPeriodUpdated(uint32 waitingPeriod);

    error InvalidInput();
    error NotCovered();
    error AlreadyClaimed();
    error InsufficientPool();
    error NothingToPay();
    error FutureDate();

    constructor(address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MODEL_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, oracle);

        // Почетни (некалибрирани) параметри. Се калибрираат со ML моделот од истражувањето
        // и се ажурираат преку setCropParams – секоја промена останува видлива на синџирот.
        cropParams[0] = CropParams(-5, 2500, 150, 400);  // Домат:      критично -0.5 °C
        cropParams[1] = CropParams(-5, 2800, 170, 450);  // Пипер:      критично -0.5 °C
        cropParams[2] = CropParams(0, 3000, 200, 500);   // Краставица: критично  0.0 °C
        cropParams[3] = CropParams(-30, 1500, 50, 200);  // Салата:     критично -3.0 °C

        protectionBps[0] = 10_000; // отворено: целата штета
        protectionBps[1] = 6_000;  // нисок тунел: 60 %
        protectionBps[2] = 2_500;  // пластеник: 25 %
    }

    // ================= Базен на средства =================

    function fundPool() external payable {
        if (msg.value == 0) revert InvalidInput();
        emit PoolFunded(msg.sender, msg.value);
    }

    receive() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    /// Админот може да повлече само средства што не се потребни за активното покритие.
    function withdrawSurplus(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (amount > freeLiquidity()) revert InsufficientPool();
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Transfer failed");
        emit PoolWithdrawn(to, amount);
    }

    function poolBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function freeLiquidity() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > totalCoverageActive ? bal - totalCoverageActive : 0;
    }

    // ================= Полиси =================

    function quotePremium(uint256 coverage) public view returns (uint256) {
        return (coverage * premiumRateBps) / BPS;
    }

    /// Земјоделецот купува полиса; премијата се плаќа во иста трансакција.
    function buyPolicy(
        uint8 region,
        uint8 crop,
        uint8 prodType,
        uint32 areaM2,
        uint32 seasonStart,
        uint32 seasonEnd,
        uint256 coverage
    ) external payable nonReentrant returns (uint256 policyId) {
        if (region >= REGION_COUNT || crop >= CROP_COUNT || prodType >= PROD_COUNT) revert InvalidInput();
        if (areaM2 == 0 || coverage == 0) revert InvalidInput();
        if (!_validDate(seasonStart) || !_validDate(seasonEnd) || seasonEnd < seasonStart) revert InvalidInput();

        uint256 premium = quotePremium(coverage);
        if (msg.value != premium) revert InvalidInput();

        // Базенот (заедно со новата премија) мора да може да го покрие новото покритие.
        if (address(this).balance < totalCoverageActive + coverage) revert InsufficientPool();

        policies.push(Policy({
            farmer: msg.sender,
            region: region,
            crop: crop,
            prodType: prodType,
            areaM2: areaM2,
            seasonStart: seasonStart,
            seasonEnd: seasonEnd,
            coverage: coverage,
            premium: premium,
            paidOut: 0,
            createdAt: uint64(block.timestamp)
        }));
        policyId = policies.length - 1;
        _policiesOf[msg.sender].push(policyId);
        totalCoverageActive += coverage;

        emit PolicyCreated(policyId, msg.sender, region, crop, prodType, coverage, premium);
    }

    // ================= Оракул: мразни настани =================

    function reportFrost(
        uint8 region,
        uint32 date,
        int16 minTemp,
        uint16 hoursBelow0,
        uint16 hoursBelowM2,
        bytes32 dataHash
    ) external onlyRole(ORACLE_ROLE) returns (uint256 eventId) {
        if (region >= REGION_COUNT || !_validDate(date)) revert InvalidInput();
        if (minTemp > 0 || hoursBelowM2 > hoursBelow0 || hoursBelow0 > 24) revert InvalidInput();
        // Мраз може да се пријави само откако неговиот ден започнал – не однапред.
        if (dateToTimestamp(date) > block.timestamp) revert FutureDate();

        bytes32 key = keccak256(abi.encodePacked(region, date));
        if (eventKeyUsed[key]) revert InvalidInput();
        eventKeyUsed[key] = true;

        frostEvents.push(FrostEvent({
            region: region,
            date: date,
            minTemp: minTemp,
            hoursBelow0: hoursBelow0,
            hoursBelowM2: hoursBelowM2,
            dataHash: dataHash,
            reportedAt: uint64(block.timestamp),
            reporter: msg.sender
        }));
        eventId = frostEvents.length - 1;
        emit FrostReported(eventId, region, date, minTemp, hoursBelow0, hoursBelowM2, dataHash);
    }

    // ================= Модел за штета =================

    /// Проценета штета (bps) за дадена култура и тип на производство при даден мраз.
    function estimateDamage(uint8 crop, uint8 prodType, int16 minTemp, uint16 hoursBelow0, uint16 hoursBelowM2)
        public
        view
        returns (uint16)
    {
        if (crop >= CROP_COUNT || prodType >= PROD_COUNT) revert InvalidInput();
        CropParams memory p = cropParams[crop];

        uint256 raw = 0;
        if (minTemp < p.criticalTemp) {
            uint256 tenthsBelow = uint256(int256(p.criticalTemp) - int256(minTemp));
            raw += (tenthsBelow * p.bpsPerDegree) / 10;
        }
        // Траењето носи штета само ако температурата навистина ја поминала критичната.
        if (minTemp <= p.criticalTemp) {
            raw += uint256(hoursBelow0) * p.bpsPerHourBelow0;
            raw += uint256(hoursBelowM2) * p.bpsPerHourBelowM2;
        }
        if (raw > BPS) raw = BPS;

        uint256 damage = (raw * protectionBps[prodType]) / BPS;
        return uint16(damage);
    }

    function damageForEvent(uint8 crop, uint8 prodType, uint256 eventId) public view returns (uint16) {
        FrostEvent memory e = frostEvents[eventId];
        return estimateDamage(crop, prodType, e.minTemp, e.hoursBelow0, e.hoursBelowM2);
    }

    // ================= Исплата =================

    function previewClaim(uint256 policyId, uint256 eventId) public view returns (uint16 damageBps, uint256 amount) {
        Policy memory pol = policies[policyId];
        FrostEvent memory e = frostEvents[eventId];
        if (!_covers(pol, e)) return (0, 0);
        if (claimed[policyId][eventId]) return (0, 0);
        damageBps = estimateDamage(pol.crop, pol.prodType, e.minTemp, e.hoursBelow0, e.hoursBelowM2);
        amount = (pol.coverage * damageBps) / BPS;
        uint256 remaining = pol.coverage - pol.paidOut;
        if (amount > remaining) amount = remaining;
    }

    /// Секој може да ја активира исплатата (земјоделецот или backend-от);
    /// парите секогаш одат кај земјоделецот од полисата.
    function claim(uint256 policyId, uint256 eventId) external nonReentrant returns (uint256 amount) {
        if (policyId >= policies.length || eventId >= frostEvents.length) revert InvalidInput();
        if (claimed[policyId][eventId]) revert AlreadyClaimed();

        Policy storage pol = policies[policyId];
        FrostEvent memory e = frostEvents[eventId];
        if (!_covers(pol, e)) revert NotCovered();

        uint16 damageBps = estimateDamage(pol.crop, pol.prodType, e.minTemp, e.hoursBelow0, e.hoursBelowM2);
        amount = (pol.coverage * damageBps) / BPS;
        uint256 remaining = pol.coverage - pol.paidOut;
        if (amount > remaining) amount = remaining;
        if (amount == 0) revert NothingToPay();

        claimed[policyId][eventId] = true;
        pol.paidOut += amount;
        totalCoverageActive -= amount;

        claims.push(Claim(policyId, eventId, damageBps, amount, uint64(block.timestamp)));

        (bool ok, ) = payable(pol.farmer).call{value: amount}("");
        require(ok, "Transfer failed");

        emit ClaimPaid(claims.length - 1, policyId, eventId, damageBps, amount);
    }

    /// По истекот на сезоната, неискористеното покритие се ослободува од резервата.
    /// Оракулот има уште 3 дена по крајот на сезоната да ги пријави последните мразеви.
    function expirePolicy(uint256 policyId) external {
        Policy storage pol = policies[policyId];
        if (block.timestamp < dateToTimestamp(pol.seasonEnd) + 4 days) revert InvalidInput();
        uint256 remaining = pol.coverage - pol.paidOut;
        if (remaining == 0) revert NothingToPay();
        pol.paidOut = pol.coverage; // нема повеќе исплати
        totalCoverageActive -= remaining;
    }

    // ================= Управување со моделот =================

    function setCropParams(uint8 crop, int16 criticalTemp, uint16 bpsPerDegree, uint16 bpsPerHourBelow0, uint16 bpsPerHourBelowM2)
        external
        onlyRole(MODEL_ADMIN_ROLE)
    {
        if (crop >= CROP_COUNT) revert InvalidInput();
        cropParams[crop] = CropParams(criticalTemp, bpsPerDegree, bpsPerHourBelow0, bpsPerHourBelowM2);
        emit CropParamsUpdated(crop, criticalTemp, bpsPerDegree, bpsPerHourBelow0, bpsPerHourBelowM2);
    }

    function setProtection(uint8 prodType, uint16 bps) external onlyRole(MODEL_ADMIN_ROLE) {
        if (prodType >= PROD_COUNT || bps > BPS) revert InvalidInput();
        protectionBps[prodType] = bps;
        emit ProtectionUpdated(prodType, bps);
    }

    function setWaitingPeriod(uint32 secondsToWait) external onlyRole(MODEL_ADMIN_ROLE) {
        if (secondsToWait > 30 days) revert InvalidInput();
        waitingPeriod = secondsToWait;
        emit WaitingPeriodUpdated(secondsToWait);
    }

    function setPremiumRate(uint16 bps) external onlyRole(MODEL_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert InvalidInput();
        premiumRateBps = bps;
        emit PremiumRateUpdated(bps);
    }

    // ================= Читање =================

    function policyCount() external view returns (uint256) { return policies.length; }
    function eventCount() external view returns (uint256) { return frostEvents.length; }
    function claimCount() external view returns (uint256) { return claims.length; }
    function policiesOf(address farmer) external view returns (uint256[] memory) { return _policiesOf[farmer]; }

    function getPolicy(uint256 id) external view returns (Policy memory) { return policies[id]; }
    function getFrostEvent(uint256 id) external view returns (FrostEvent memory) { return frostEvents[id]; }
    function getClaim(uint256 id) external view returns (Claim memory) { return claims[id]; }
    function getAllCropParams() external view returns (CropParams[CROP_COUNT] memory) { return cropParams; }
    function getAllProtection() external view returns (uint16[PROD_COUNT] memory) { return protectionBps; }

    // ================= Помошни =================

    /// Дали полисата го покрива настанот: ист регион, во сезоната и по периодот на чекање.
    function _covers(Policy memory pol, FrostEvent memory e) internal view returns (bool) {
        if (e.region != pol.region || e.date < pol.seasonStart || e.date > pol.seasonEnd) return false;
        return dateToTimestamp(e.date) + 1 days > uint256(pol.createdAt) + waitingPeriod;    }

    /// YYYYMMDD -> Unix време на полноќ (UTC). Алгоритам „days from civil“.
    function dateToTimestamp(uint32 d) public pure returns (uint256) {
        int256 y = int256(uint256(d / 10000));
        int256 m = int256(uint256((d / 100) % 100));
        int256 day = int256(uint256(d % 100));
        int256 days_ = day - 32075 + (1461 * (y + 4800 + (m - 14) / 12)) / 4
            + (367 * (m - 2 - ((m - 14) / 12) * 12)) / 12
            - (3 * ((y + 4900 + (m - 14) / 12) / 100)) / 4
            - 2440588;
        return uint256(days_) * 1 days;
    }

    function _validDate(uint32 d) internal pure returns (bool) {
        uint32 y = d / 10000;
        uint32 m = (d / 100) % 100;
        uint32 day = d % 100;
        return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && day >= 1 && day <= 31;
    }
}
