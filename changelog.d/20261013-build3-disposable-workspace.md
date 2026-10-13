## Changed

- mark the Appium Android build (`build_3`) in `peak_flow.yml` with `persist_workspace: false` so its container stays disposable: the Android toolchain state it installs during the script phase (SDK, NDK, emulator system image, AVD, gradle caches) is build output rather than a reusable dependency install, and persisting it pushed the shared project cache to ~31 GiB against its 32 GiB cap, ping-ponging against the lean `build_1`/`build_2` commits on every run
