const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const ts = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;

const E = (n) => ethers.parseEther(String(n));
const REGION = { STRUMICA: 0, GEVGELIJA: 1 };
const CROP = { DOMAT: 0, PIPER: 1, KRASTAVICA: 2, SALATA: 3 };
const PROD = { OTVORENO: 0, TUNEL: 1, PLASTENIK: 2 };
const HASH = ethers.id("raw-hourly-data");

describe("FrostShield", () => {
  let c, admin, oracle, farmer, other;

  async function fixture() {
    const signers = await ethers.getSigners();
    const contract = await ethers.deployContract("FrostShield", [signers[1].address]);
    await contract.fundPool({ value: E(20) });
    // Сезоната 2027 почнува: полисите се купуваат во средина на јануари.
    if ((await time.latest()) < ts(2027, 1, 15)) await time.increaseTo(ts(2027, 1, 15));
    return { contract, signers };
  }

  beforeEach(async () => {
    const f = await loadFixture(fixture);
    c = f.contract;
    [admin, oracle, farmer, other] = f.signers;
  });

  /** Оракулот пријавува мраз; времето на синџирот се поместува на денот по мразот. */
  async function report(region, date, minTemp, h0, hm2) {
    const y = Math.floor(date / 10000), m = Math.floor(date / 100) % 100, d = date % 100;
    const after = ts(y, m, d) + 86400;
    if ((await time.latest()) < after) await time.increaseTo(after);
    return c.connect(oracle).reportFrost(region, date, minTemp, h0, hm2, HASH);
  }

  async function buy(opts = {}) {
    const o = { region: REGION.STRUMICA, crop: CROP.DOMAT, prod: PROD.OTVORENO, area: 5000,
      start: 20270201, end: 20270430, coverage: E(2), ...opts };
    const premium = await c.quotePremium(o.coverage);
    await c.connect(farmer).buyPolicy(o.region, o.crop, o.prod, o.area, o.start, o.end, o.coverage, { value: premium });
    return (await c.policyCount()) - 1n;
  }

  it("наплатува премија од 5 % и резервира покритие", async () => {
    expect(await c.quotePremium(E(2))).to.equal(E(0.1));
    await buy();
    const p = await c.getPolicy(0);
    expect(p.farmer).to.equal(farmer.address);
    expect(p.premium).to.equal(E(0.1));
    expect(await c.totalCoverageActive()).to.equal(E(2));
  });

  it("одбива погрешна премија и полиса што базенот не може да ја покрие", async () => {
    await expect(c.connect(farmer).buyPolicy(0, 0, 0, 100, 20270201, 20270430, E(2), { value: 1 }))
      .to.be.revertedWithCustomError(c, "InvalidInput");
    const big = E(100);
    await expect(c.connect(farmer).buyPolicy(0, 0, 0, 100, 20270201, 20270430, big, { value: await c.quotePremium(big) }))
      .to.be.revertedWithCustomError(c, "InsufficientPool");
  });

  it("не прифаќа мраз со датум во иднина", async () => {
    await expect(c.connect(oracle).reportFrost(0, 20270315, -25, 5, 2, HASH))
      .to.be.revertedWithCustomError(c, "FutureDate");
  });

  it("само оракулот може да пријави мраз, и само еднаш по регион и датум", async () => {
    await time.increaseTo(ts(2027, 3, 16));
    await expect(c.connect(other).reportFrost(0, 20270315, -25, 5, 2, HASH))
      .to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount");
    await report(0, 20270315, -25, 5, 2);
    await expect(c.connect(oracle).reportFrost(0, 20270315, -30, 6, 3, HASH))
      .to.be.revertedWithCustomError(c, "InvalidInput");
  });

  it("пресметува штета според моделот: пластеник штити повеќе од отворено", async () => {
    // Домат: критично -0.5 °C; мраз -2.5 °C, 5 часа под 0, 2 часа под -2
    // raw = 20 десетинки * 2500 / 10 + 5*150 + 2*400 = 5000 + 750 + 800 = 6550 bps
    expect(await c.estimateDamage(CROP.DOMAT, PROD.OTVORENO, -25, 5, 2)).to.equal(6550);
    expect(await c.estimateDamage(CROP.DOMAT, PROD.TUNEL, -25, 5, 2)).to.equal(3930);
    expect(await c.estimateDamage(CROP.DOMAT, PROD.PLASTENIK, -25, 5, 2)).to.equal(1637);
    // Салата поднесува до -3 °C: нема штета
    expect(await c.estimateDamage(CROP.SALATA, PROD.OTVORENO, -25, 5, 2)).to.equal(0);
    // Ограничено на 100 %
    expect(await c.estimateDamage(CROP.KRASTAVICA, PROD.OTVORENO, -80, 12, 8)).to.equal(10000);
  });

  it("исплаќа автоматски кај земјоделецот, без двојна исплата", async () => {
    const id = await buy();
    await report(REGION.STRUMICA, 20270315, -25, 5, 2);

    const [bps, amount] = await c.previewClaim(id, 0);
    expect(bps).to.equal(6550);
    expect(amount).to.equal(E(2) * 6550n / 10000n);

    // Секој може да ја повика исплатата, парите одат кај земјоделецот
    await expect(c.connect(other).claim(id, 0)).to.changeEtherBalances([farmer, c], [amount, -amount]);
    await expect(c.connect(other).claim(id, 0)).to.be.revertedWithCustomError(c, "AlreadyClaimed");
    expect(await c.totalCoverageActive()).to.equal(E(2) - amount);
  });

  it("не исплаќа за друг регион или настан надвор од сезоната", async () => {
    const id = await buy();
    await report(REGION.GEVGELIJA, 20270315, -40, 6, 4);
    await report(REGION.STRUMICA, 20270505, -40, 6, 4);
    await expect(c.claim(id, 0)).to.be.revertedWithCustomError(c, "NotCovered");
    await expect(c.claim(id, 1)).to.be.revertedWithCustomError(c, "NotCovered");
  });

  it("вкупната исплата никогаш не го надминува покритието", async () => {
    const id = await buy({ crop: CROP.KRASTAVICA });
    await report(0, 20270310, -60, 10, 6); // 100 %
    await report(0, 20270320, -60, 10, 6);
    await c.claim(id, 0);
    await expect(c.claim(id, 1)).to.be.revertedWithCustomError(c, "NothingToPay");
    expect((await c.getPolicy(id)).paidOut).to.equal(E(2));
  });

  it("админот повлекува само слободна ликвидност", async () => {
    await buy();
    const free = await c.freeLiquidity();
    await expect(c.withdrawSurplus(admin.address, free + 1n)).to.be.revertedWithCustomError(c, "InsufficientPool");
    await expect(c.withdrawSurplus(admin.address, free)).to.changeEtherBalance(admin, free);
  });

  it("параметрите на моделот се менуваат само од админ и јавно се логираат", async () => {
    await expect(c.connect(other).setCropParams(0, -10, 2000, 100, 300))
      .to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount");
    await expect(c.setCropParams(0, -10, 2000, 100, 300))
      .to.emit(c, "CropParamsUpdated").withArgs(0, -10, 2000, 100, 300);
    expect((await c.cropParams(0)).criticalTemp).to.equal(-10);
  });

  it("истечена полиса го ослободува резервираното покритие", async () => {
    const id = await buy();
    await expect(c.expirePolicy(id)).to.be.revertedWithCustomError(c, "InvalidInput");
    await time.increaseTo(ts(2027, 5, 4));
    await c.expirePolicy(id);
    expect(await c.totalCoverageActive()).to.equal(0);
  });

  it("ги претвора датумите во Unix време точно", async () => {
    expect(await c.dateToTimestamp(19700101)).to.equal(0);
    expect(await c.dateToTimestamp(20270315)).to.equal(BigInt(Date.UTC(2027, 2, 15) / 1000));
    expect(await c.dateToTimestamp(20240229)).to.equal(BigInt(Date.UTC(2024, 1, 29) / 1000));
  });

  describe("период на чекање", () => {
    it("не покрива мраз пред купувањето ниту во првите 3 дена", async () => {
      await report(0, 20270315, -40, 6, 4);   // мраз пред полисата
      await time.increaseTo(ts(2027, 3, 20, 12)); // купува 20 март напладне
      const id = await buy();
      await report(0, 20270322, -40, 6, 4); // 1.5 ден по купувањето
      await report(0, 20270325, -40, 6, 4); // по чекањето

      expect((await c.previewClaim(id, 0)).amount).to.equal(0);
      await expect(c.claim(id, 0)).to.be.revertedWithCustomError(c, "NotCovered");
      await expect(c.claim(id, 1)).to.be.revertedWithCustomError(c, "NotCovered");
      await expect(c.claim(id, 2)).to.emit(c, "ClaimPaid");
    });
  });
});
