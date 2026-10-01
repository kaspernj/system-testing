## Added

- add a `LatencyCalibrator` that adapts notification-detection and element-lookup deadline budgets to the measured responsiveness of the current session
- add unit coverage for the `LatencyCalibrator` scaling, floor, ceiling, and window behavior

## Changed

- scale the default notification-message window and the element-lookup base budget to cover recent operation latency on slow runners, bounded by a hard ceiling
- keep caller-supplied timeouts and healthy-box defaults unchanged: the budget only grows when recent operations actually waited, and never drops below the existing default
