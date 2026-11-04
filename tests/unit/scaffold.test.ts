import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Home from "../../src/app/page";

describe("scaffold", () => {
  it("renders a generic shell without product data", () => {
    expect(renderToStaticMarkup(createElement(Home))).toContain(
      "Whales Rewards",
    );
  });
});
