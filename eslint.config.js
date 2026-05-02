import js from "@eslint/js"
import {jsdoc} from "eslint-plugin-jsdoc"
import globals from "globals"
import {defineConfig, globalIgnores} from "eslint/config"

export default defineConfig([
  globalIgnores(["build/**", "spec/dummy/**"]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {js},
    extends: ["js/recommended"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jasmine,
        ...globals.node
      }
    },
    rules: {
      "object-curly-spacing": ["error", "never"]
    }
  },
  jsdoc({
    config: "flat/recommended",
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "jsdoc/reject-any-type": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off"
    }
  })
])
