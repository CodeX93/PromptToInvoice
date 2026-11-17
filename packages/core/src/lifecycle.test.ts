import { describe, expect, it } from "vitest";
import {
  LifecycleError,
  amountDue,
  assertCan,
  can,
  displayStatus,
  statusAfterPayment,
  type LifecycleFacts,
} from "./lifecycle";

const facts = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  status: "open",
  docType: "invoice",
  total: 10000,
  amountPaid: 0,
  dueDate: "2026-06-30",
  sentAt: null,
  viewedAt: null,
  ...over,
});

describe("permissions", () => {
  it("only drafts are editable and deletable", () => {
    expect(can(facts({ status: "draft" }), "edit")).toBe(true);
    expect(can(facts({ status: "open" }), "edit")).toBe(false);
    expect(can(facts({ status: "paid" }), "delete")).toBe(false);
  });

  it("void invoices allow nothing", () => {
    for (const a of [
      "edit",
      "delete",
      "issue",
      "send",
      "record_payment",
      "void",
      "credit",
    ] as const) {
      expect(can(facts({ status: "void" }), a)).toBe(false);
    }
  });

  it("credit notes cannot be credited or paid", () => {
    expect(can(facts({ docType: "credit_note" }), "credit")).toBe(false);
    expect(can(facts({ docType: "credit_note" }), "record_payment")).toBe(false);
  });

  it("throws a descriptive error", () => {
    expect(() => {
      assertCan(facts({ status: "paid" }), "edit");
    }).toThrow(LifecycleError);
    expect(() => {
      assertCan(facts({ status: "paid" }), "record_payment");
    }).toThrow("Cannot record payment an invoice that is paid.");
  });
});

describe("displayStatus", () => {
  const today = "2026-06-15";
  it.each([
    [{ status: "draft" }, "draft"],
    [{}, "issued"],
    [{ sentAt: "2026-06-01" }, "sent"],
    [{ sentAt: "2026-06-01", viewedAt: "2026-06-02" }, "viewed"],
    [{ amountPaid: 100 }, "partially_paid"],
    [{ dueDate: "2026-06-14", amountPaid: 100 }, "overdue"],
    [{ dueDate: "2026-06-15" }, "issued"],
    [{ status: "paid", dueDate: "2020-01-01" }, "paid"],
    [{ status: "void" }, "void"],
    [{ docType: "credit_note", dueDate: "2020-01-01" }, "issued"],
  ] as const)("%j -> %s", (over, expected) => {
    expect(displayStatus(facts(over as Partial<LifecycleFacts>), today)).toBe(expected);
  });
});

describe("payments", () => {
  it("derives paid state", () => {
    expect(statusAfterPayment(100, 99)).toBe("open");
    expect(statusAfterPayment(100, 100)).toBe("paid");
    expect(statusAfterPayment(100, 150)).toBe("paid");
    expect(statusAfterPayment(0, 0)).toBe("open");
  });

  it("computes amount due", () => {
    expect(amountDue(facts({ amountPaid: 2500 }))).toBe(7500);
    expect(amountDue(facts({ amountPaid: 20000 }))).toBe(0);
    expect(amountDue(facts({ status: "void" }))).toBe(0);
  });
});
