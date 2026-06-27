// @ts-check

/**
 * Escapes a value for use inside a double-quoted CSS attribute selector.
 * @param {string | number} value Raw attribute value.
 * @returns {string} Value safe to embed inside double quotes.
 */
export function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
}

/**
 * Builds a `data-testid` (or custom attribute) CSS selector with a safely escaped test ID.
 * @param {string} testID Raw test ID value.
 * @param {string} [attribute] Attribute name, defaults to `data-testid`.
 * @returns {string} CSS attribute selector like `[data-testid="value"]`.
 */
export function testIdSelector(testID, attribute = "data-testid") {
  return `[${attribute}="${cssAttributeValue(testID)}"]`
}
