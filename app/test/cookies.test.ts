import { describe, expect, test } from "bun:test";
import { cookieFran, parse, serialize, serializeCleared } from "../src/cookies.ts";

describe("cookies", () => {
  test("serialize sätter HttpOnly, Secure och SameSite", () => {
    const rad = serialize("sport_session", "abc", { maxAge: 100 });
    expect(rad).toContain("sport_session=abc");
    expect(rad).toContain("Path=/");
    expect(rad).toContain("Max-Age=100");
    expect(rad).toContain("HttpOnly");
    expect(rad).toContain("Secure");
    expect(rad).toContain("SameSite=Lax");
  });

  test("parse läser flera kakor", () => {
    expect(parse("a=1; b=2; tom=")).toEqual({ a: "1", b: "2", tom: "" });
  });

  test("parse tål skräp", () => {
    expect(parse("; ;=; trasig")).toEqual({});
    expect(parse(null)).toEqual({});
  });

  test("avkodar procenttecken", () => {
    expect(parse("namn=K%C3%A4rrtorp").namn).toBe("Kärrtorp");
  });

  test("cookieFran läser huvudet", () => {
    const req = new Request("http://x/", { headers: { cookie: "sport_session=xyz" } });
    expect(cookieFran(req).sport_session).toBe("xyz");
  });

  test("serializeCleared nollar kakan", () => {
    expect(serializeCleared("sport_session")).toContain("Max-Age=0");
  });
});
