import { describe, expect, it } from "vitest";
import { installTaskKey, liveInstallKey, planInstallTask, previousWorkingDay } from "./install";

const pin = (day: string) => new Date(`${day}T12:00:00.000Z`);
const row = (installDate: Date | null) => ({ id: "a1", installDate, crew: { name: "Apex Roofing" } });

describe("previousWorkingDay", () => {
  it("steps back over a weekend", () => {
    expect(previousWorkingDay("2026-10-14")).toBe("2026-10-13"); // Wed → Tue
    expect(previousWorkingDay("2026-10-12")).toBe("2026-10-09"); // Mon → Fri
    expect(previousWorkingDay("2026-10-11")).toBe("2026-10-09"); // Sun → Fri
  });
});

describe("planInstallTask", () => {
  it("is due the working day before the install", () => {
    const t = planInstallTask(row(pin("2026-10-14")), "2026-10-05");
    expect(t).toMatchObject({ sourceKey: "crew-install:a1:ready@2026-10-14", installDay: "2026-10-14", dueDay: "2026-10-13" });
    expect(t?.title).toBe("Get ready: Apex Roofing installs Wed, Oct 14");
  });

  it("a Monday install is due the Friday before", () => {
    expect(planInstallTask(row(pin("2026-10-12")), "2026-10-05")?.dueDay).toBe("2026-10-09");
  });

  it("is due today when the working day before has come or gone", () => {
    expect(planInstallTask(row(pin("2026-10-06")), "2026-10-05")?.dueDay).toBe("2026-10-05");
    expect(planInstallTask(row(pin("2026-10-05")), "2026-10-05")?.dueDay).toBe("2026-10-05");
    // Saved on a Saturday for the Monday: Friday has passed.
    expect(planInstallTask(row(pin("2026-10-12")), "2026-10-10")?.dueDay).toBe("2026-10-10");
  });

  it("raises nothing without a date or for a day that has passed", () => {
    expect(planInstallTask(row(null), "2026-10-05")).toBeNull();
    expect(planInstallTask(row(pin("2026-10-02")), "2026-10-05")).toBeNull();
  });

  it("reads a date saved at midnight UTC as that day", () => {
    expect(planInstallTask(row(new Date("2026-10-14")), "2026-10-05")?.installDay).toBe("2026-10-14");
  });
});

describe("liveInstallKey", () => {
  it("carries the date, so a moved install is a different key", () => {
    expect(liveInstallKey({ id: "a1", installDate: pin("2026-10-14") })).toBe(installTaskKey("a1", "2026-10-14"));
    expect(liveInstallKey({ id: "a1", installDate: pin("2026-10-15") })).not.toBe(installTaskKey("a1", "2026-10-14"));
    expect(liveInstallKey({ id: "a1", installDate: null })).toBeNull();
  });
});
