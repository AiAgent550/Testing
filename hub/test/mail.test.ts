import { describe, expect, it } from "vitest";
import { composeEmail, planAttachments } from "../src/modules/mail/compose";
import { sniffVideo } from "../src/modules/jobs/files";

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) typeof p === "string" ? out.push(...[...p].map(c => c.charCodeAt(0))) : out.push(...p);
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};

describe("video type sniffing", () => {
  it("recognises phone videos by their bytes", () => {
    expect(sniffVideo(bytes([0, 0, 0, 24], "ftypmp42"))).toBe("video/mp4");
    expect(sniffVideo(bytes([0, 0, 0, 24], "ftypisom"))).toBe("video/mp4");
    expect(sniffVideo(bytes([0, 0, 0, 20], "ftypqt  "))).toBe("video/quicktime");
    expect(sniffVideo(bytes([0, 0, 0, 24], "ftyp3gp4"))).toBe("video/3gpp");
    expect(sniffVideo(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video/webm");
  });
  it("rejects photos and other files", () => {
    expect(sniffVideo(bytes([0, 0, 0, 24], "ftypheic"))).toBeNull();
    expect(sniffVideo(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(sniffVideo(bytes("%PDF-1.7"))).toBeNull();
  });
});

describe("customer email", () => {
  const business = { tradingName: "Curve Performance", phone: "07734 272203", email: "info@curveperformance.co.uk", website: "curveperformance.co.uk", legal: "Legal line." };
  it("attaches photos until the budget is used and links videos and the rest", () => {
    const plan = planAttachments([
      { id: "a", kind: "photo", bytes: 400 }, { id: "v", kind: "video", bytes: 10 }, { id: "b", kind: "photo", bytes: 500 }, { id: "c", kind: "photo", bytes: 200 },
    ], 700);
    expect(plan).toEqual({ attach: ["a", "c"], link: ["v", "b"] });
  });
  it("escapes the message, keeps line breaks and adds the link button", () => {
    const { html, text } = composeEmail({ message: "Hi <b>Tom</b>,\n\nAll done.\nSee https://curveperformance.co.uk", link: { url: "https://hub.example/r/abc", count: 2, expires: "13 Dec 2026" }, business });
    expect(html).toContain("Hi &lt;b&gt;Tom&lt;/b&gt;,");
    expect(html).toContain("All done.<br>See <a href=\"https://curveperformance.co.uk\"");
    expect(html).toContain("View photos and videos (2)");
    expect(text).toContain("https://hub.example/r/abc");
    expect(text).toContain("07734 272203");
  });
});
