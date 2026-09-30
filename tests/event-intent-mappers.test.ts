import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPE_LIST } from "@/server/communications/contracts";
import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  MalformedEventError,
  requireString,
} from "@/server/services/event-intent-mappers";

describe("buildMapperTable (COM-01)", () => {
  const table = buildMapperTable(EVENT_MAPPER_GROUPS);

  it("has an entry for every DomainEventType member", () => {
    for (const type of DOMAIN_EVENT_TYPE_LIST) {
      expect(table).toHaveProperty(type);
      expect(Array.isArray(table[type])).toBe(true);
    }
  });

  it("maps a type with no registered mapper to an empty array", () => {
    expect(table["payment.failed"]).toEqual([]);
  });

  it("registers exactly one mapper for ticket.public_reply_added", () => {
    expect(table["ticket.public_reply_added"]).toHaveLength(1);
  });
});

describe("requireString", () => {
  it("returns the string value when present", () => {
    expect(requireString({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("throws MalformedEventError when the field is missing", () => {
    expect(() => requireString({}, "foo")).toThrow(MalformedEventError);
  });

  it("throws MalformedEventError when the field is not a string", () => {
    expect(() => requireString({ foo: 123 }, "foo")).toThrow(MalformedEventError);
  });

  it("throws MalformedEventError for an empty string", () => {
    expect(() => requireString({ foo: "" }, "foo")).toThrow(MalformedEventError);
  });
});
