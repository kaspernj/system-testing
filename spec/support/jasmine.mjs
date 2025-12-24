export default {
  spec_dir: "spec",
  spec_files: [
    "**/*[sS]pec.?(m)js",
    "!**/node_modules/**"
  ],
  helpers: [
    "helpers/**/*.?(m)js"
  ],
  env: {
    stopSpecOnExpectationFailure: false,
    random: true,
    forbidDuplicateNames: true
  }
}
