import { describe, expect, it } from "vitest";
import { stubParse } from "./stub";

const clients = [{ id: "c1", name: "Acme Corp" }];

describe("stub extractor", () => {
  it("parses the canonical prompt", () => {
    const o = stubParse("10 hours of consulting for Acme Corp at $120/hour, due in 30 days", clients, "2026-11-17");
    expect(o.client.matchedClientId).toBe("c1");
    expect(o.currency).toBe("USD");
    expect(o.paymentTermsDays).toBe(30);
    expect(o.lines).toEqual([expect.objectContaining({ description: "Consulting", quantity: "10", unit: "h", unitPrice: "120" })]);
  });

  it("splits multiple items and reads European numbers", () => {
    const o = stubParse("3 days workshop for Halden at €650 plus hosting €1.200,50", [], "2026-11-17");
    expect(o.lines.map((l) => [l.description, l.quantity, l.unitPrice])).toEqual([
      ["Workshop", "3", "650"],
      ["Hosting", "1", "1200.50"],
    ]);
    expect(o.client.name).toBe("Halden");
  });

  it("doesn't trip over words containing 'at'", () => {
    const o = stubParse("16h implementation for Nordlicht at €110/h", [], "2026-11-17");
    expect(o.lines[0]).toMatchObject({ description: "Implementation", quantity: "16", unit: "h", unitPrice: "110" });
  });

  it("detects repeat requests", () => {
    expect(stubParse("same as last month for Acme Corp", clients, "2026-11-17")).toMatchObject({ copyFromPrevious: true, lines: [] });
  });
});
