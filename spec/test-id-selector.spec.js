// @ts-check

import {cssAttributeValue, testIdSelector} from "../src/test-id-selector.js"

describe("test-id-selector", () => {
  describe("cssAttributeValue", () => {
    it("leaves simple values untouched", () => {
      expect(cssAttributeValue("saveButton")).toEqual("saveButton")
    })

    it("escapes double quotes", () => {
      expect(cssAttributeValue("name\"Input")).toEqual("name\\\"Input")
    })

    it("escapes backslashes", () => {
      expect(cssAttributeValue("a\\b")).toEqual("a\\\\b")
    })

    it("escapes backslashes before quotes so the result stays balanced", () => {
      expect(cssAttributeValue("a\\\"b")).toEqual("a\\\\\\\"b")
    })

    it("coerces non-string values to strings", () => {
      expect(cssAttributeValue(42)).toEqual("42")
    })
  })

  describe("testIdSelector", () => {
    it("builds a double-quoted data-testid selector by default", () => {
      expect(testIdSelector("saveButton")).toEqual("[data-testid=\"saveButton\"]")
    })

    it("escapes quotes and backslashes in the test ID", () => {
      expect(testIdSelector("name\"In\\put")).toEqual("[data-testid=\"name\\\"In\\\\put\"]")
    })

    it("keeps bracket-like characters intact inside the quoted value", () => {
      expect(testIdSelector("project.board/item[1]")).toEqual("[data-testid=\"project.board/item[1]\"]")
    })

    it("supports a custom attribute name", () => {
      expect(testIdSelector("saveButton", "data-test")).toEqual("[data-test=\"saveButton\"]")
    })
  })
})
