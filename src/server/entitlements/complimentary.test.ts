import { describe, expect, it } from "vitest";
import { appliedComplimentary, canGrant } from "./complimentary";

describe("appliedComplimentary", () => {
  it("uses a grant only when it is a higher tier than the paid plan", () => {
    expect(appliedComplimentary(null, "basic")).toBe("basic");
    expect(appliedComplimentary("basic", "silver")).toBe("silver");
    expect(appliedComplimentary("basic", "basic")).toBeNull();
    expect(appliedComplimentary(null, "silver")).toBe("silver");
    expect(appliedComplimentary(null, "gold")).toBe("gold");
    expect(appliedComplimentary("silver", "gold")).toBe("gold");
    expect(appliedComplimentary("silver", "silver")).toBeNull();
    expect(appliedComplimentary("gold", "silver")).toBeNull();
    expect(appliedComplimentary("gold", "gold")).toBeNull();
    expect(appliedComplimentary("silver", null)).toBeNull();
  });
});

describe("canGrant", () => {
  const member = { role: "member" as const, paid: null, grant: null };

  it("offers Silver only to a member with no plan and no grant", () => {
    expect(canGrant(member, "silver")).toBe(true);
    expect(canGrant({ ...member, paid: "silver" }, "silver")).toBe(false);
    expect(canGrant({ ...member, grant: "silver" }, "silver")).toBe(false);
    expect(canGrant({ ...member, role: "admin" }, "silver")).toBe(false);
  });

  it("offers Basic only when they pay for nothing and have no grant", () => {
    expect(canGrant(member, "basic")).toBe(true);
    expect(canGrant({ ...member, paid: "basic" }, "basic")).toBe(false);
    expect(canGrant({ ...member, grant: "basic" }, "basic")).toBe(false);
  });

  it("offers Silver above Basic", () => {
    expect(canGrant({ ...member, paid: "basic" }, "silver")).toBe(true);
    expect(canGrant({ ...member, grant: "basic" }, "silver")).toBe(true);
    expect(canGrant({ ...member, paid: "silver" }, "silver")).toBe(false);
  });

  it("offers Gold until they are already on Gold", () => {
    expect(canGrant(member, "gold")).toBe(true);
    expect(canGrant({ ...member, paid: "silver" }, "gold")).toBe(true);
    expect(canGrant({ ...member, grant: "silver" }, "gold")).toBe(true);
    expect(canGrant({ ...member, paid: "gold" }, "gold")).toBe(false);
    expect(canGrant({ ...member, grant: "gold" }, "gold")).toBe(false);
    expect(canGrant({ ...member, role: "admin" }, "gold")).toBe(false);
  });
});
