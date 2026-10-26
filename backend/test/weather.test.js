import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFrostMetrics, hashHourly, isoToInt, intToIso } from "../src/weather.js";

test("пресметува минимум и часови под прагот", () => {
  const temps = [3, 1.2, 0.4, -0.3, -1.8, -2.4, -2.1, -0.9, 0.5, 4, null];
  const m = computeFrostMetrics(temps);
  assert.equal(m.minTempC, -2.4);
  assert.equal(m.minTempTenths, -24);
  assert.equal(m.hoursBelow0, 5);
  assert.equal(m.hoursBelowM2, 2);
  assert.equal(m.hoursMeasured, 10);
});

test("хешот е детерминистички", () => {
  const a = hashHourly(0, "2027-03-15", ["t1"], [1]);
  assert.equal(a, hashHourly(0, "2027-03-15", ["t1"], [1]));
  assert.notEqual(a, hashHourly(0, "2027-03-15", ["t1"], [2]));
});

test("конверзија на датуми", () => {
  assert.equal(isoToInt("2027-03-15"), 20270315);
  assert.equal(intToIso(20270315), "2027-03-15");
  assert.throws(() => isoToInt("15.03.2027"));
});
