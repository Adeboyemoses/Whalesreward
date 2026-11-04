import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  TextField,
  SegmentedControl,
  BottomNav,
  PhotoCapture,
} from "./index";

describe("accessible design system controls", () => {
  it("associates validation with its labelled input", () => {
    const html = renderToStaticMarkup(
      createElement(TextField, {
        id: "amount",
        label: "Amount",
        error: "Use two decimals",
      }),
    );
    expect(html).toContain('for="amount"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="amount-error"');
    expect(html).toContain('id="amount-error"');
  });
  it("prevents repeat actions while loading", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { loading: true }, "Saving…"),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });
  it("exposes the exclusive selection and current navigation", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        label: "Entry basis",
        value: "amount",
        options: [
          { value: "amount", label: "Amount" },
          { value: "quantity", label: "Litres" },
        ],
        onChange: () => {},
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Entry basis"');
    const nav = renderToStaticMarkup(
      createElement(BottomNav, {
        active: "Sale",
        pending: 2,
        items: [
          { label: "Sale", href: "#sale" },
          { label: "Register", href: "#register" },
          { label: "History", href: "#history" },
          { label: "Uploads", href: "#uploads" },
          { label: "Account", href: "#account" },
        ],
      }),
    );
    expect(nav).toContain('aria-current="page"');
    expect(nav).toContain("2 pending uploads");
  });
  it("keeps taken evidence visible when retrying capture", () => {
    const html = renderToStaticMarkup(
      createElement(PhotoCapture, {
        src: "/fixture.svg",
        alt: "Fictional meter reading",
        takenAt: "10:42 AM",
        onCapture: () => {},
      }),
    );
    expect(html).toContain('alt="Fictional meter reading"');
    expect(html).toContain("Retake");
    expect(html).not.toContain('type="file"');
  });
});
