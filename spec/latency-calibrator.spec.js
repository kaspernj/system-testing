// @ts-check

import LatencyCalibrator from "../src/drivers/latency-calibrator.js"

describe("LatencyCalibrator", () => {
  it("returns the base budget until enough real samples are recorded", () => {
    const calibrator = new LatencyCalibrator()
    expect(calibrator.adaptive(5000)).toEqual(5000)
    calibrator.record(8000)
    calibrator.record(9000)
    // Two samples, below the default minSamples of three.
    expect(calibrator.adaptive(5000)).toEqual(5000)
  })

  it("ignores sub-threshold (instant) and invalid samples", () => {
    const calibrator = new LatencyCalibrator()
    calibrator.record(120) // below the 200ms default threshold
    calibrator.record(-5)
    calibrator.record(NaN)
    calibrator.record(Infinity)
    expect(calibrator.samples).toEqual([])
    expect(calibrator.recentHighMs()).toEqual(0)
  })

  it("scales the budget to cover recent operation latency", () => {
    const calibrator = new LatencyCalibrator()
    for (const sample of [8000, 8200, 7900]) calibrator.record(sample)
    // p90 of [7900, 8000, 8200] is 8200; 8200 * 3 = 24600.
    expect(calibrator.adaptive(5000)).toEqual(24600)
  })

  it("never returns a budget below the base", () => {
    const calibrator = new LatencyCalibrator()
    for (const sample of [250, 260, 240]) calibrator.record(sample)
    // recentHigh ~260; 260 * 3 = 780, which is below the 5000 base.
    expect(calibrator.adaptive(5000)).toEqual(5000)
  })

  it("bounds the budget at the ceiling", () => {
    const calibrator = new LatencyCalibrator({ceilingMs: 30000})
    for (const sample of [20000, 21000, 19000]) calibrator.record(sample)
    // recentHigh ~21000; 21000 * 3 = 63000, capped at 30000.
    expect(calibrator.adaptive(5000)).toEqual(30000)
  })

  it("evicts samples beyond the window size", () => {
    const calibrator = new LatencyCalibrator({windowSize: 3, minSamples: 1})
    for (const sample of [1000, 2000, 3000, 4000]) calibrator.record(sample)
    expect(calibrator.samples).toEqual([2000, 3000, 4000])
  })

  it("reports the configured quantile of the recorded window", () => {
    const calibrator = new LatencyCalibrator()
    for (let sample = 300; sample <= 2200; sample += 100) calibrator.record(sample) // 300..2200
    // 20 samples; p90 rank = floor(0.9 * 20) = 18 -> the 19th smallest = 2100.
    expect(calibrator.recentHighMs()).toEqual(2100)
  })
})
