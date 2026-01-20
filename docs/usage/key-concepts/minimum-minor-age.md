---
title: Minimum Minor Age
description: Requires Renovate to wait for a specified amount of time before suggesting updates to a new minor version.
---

# Minimum Minor Age

## What is Minimum Minor Age?

`minimumMinorAge` is a feature that requires Renovate to wait for a specified amount of time before suggesting updates to a new minor version.

Unlike [`minimumReleaseAge`](./minimum-release-age.md), which waits for each individual version to mature, `minimumMinorAge` waits for the **first release of a minor version** to mature, then allows updates to the latest patch version of that minor.

This is particularly useful when you want to adopt new minor versions conservatively, but once a minor version has proven stable, you want to stay current with the latest patches.

## How does it work?

For example, given the following releases:

- `1.0.0` - Released July 1st
- `1.1.0` - Released Aug 1st (first release of minor version 1.1)
- `1.1.1` - Released Aug 2nd (patch release)
- `1.1.3` - Released Aug 8th (patch release)

And the following configuration:

```json
{
  "packageRules": [
    {
      "matchDatasources": ["npm"],
      "minimumMinorAge": "7 days"
    }
  ]
}
```

- **If Renovate runs on Aug 2nd**: The minor version `1.1.x` has only been available for 1 day (since `1.1.0` was released on Aug 1st), which is less than the required 7 days. Renovate will keep the repo on `1.0.0`.

- **If Renovate runs on Aug 9th**: The minor version `1.1.x` has been available for 8 days (since `1.1.0` was released on Aug 1st), which exceeds the 7-day requirement. Renovate will update to `1.1.3`, the latest patch version of the matured minor version.

## Key Differences from minimumReleaseAge

| Feature | `minimumReleaseAge` | `minimumMinorAge` |
|---------|---------------------|-------------------|
| **What it checks** | Each individual version | First release of each minor version |
| **Update behavior** | Waits for each version to mature | Waits for minor version to mature, then takes latest patch |
| **Use case** | Conservative updates to all versions | Conservative minor version adoption, but quick patch updates |

## Configuration options

The following configuration options work with Minimum Minor Age:

- [`minimumMinorAge`](../configuration-options.md#minimumminorage) - Time required before a new minor version is considered stable
- [`minimumReleaseAgeBehaviour`](../configuration-options.md#minimumreleaseagebehaviour) - Controls whether the `releaseTimestamp` is required (shared with `minimumReleaseAge`)
- [`internalChecksFilter`](../configuration-options.md#internalchecksfilter) - Controls whether branches are created for pending updates

## Combining with minimumReleaseAge

You can use both `minimumMinorAge` and `minimumReleaseAge` together. When both are configured:

1. First, `minimumMinorAge` checks if the minor version has matured
2. Then, `minimumReleaseAge` checks if the specific patch version has matured

For example:

```json
{
  "packageRules": [
    {
      "matchDatasources": ["npm"],
      "minimumMinorAge": "7 days",
      "minimumReleaseAge": "3 days"
    }
  ]
}
```

With this configuration:
- A new minor version must be at least 7 days old before any of its patches are considered
- Once the minor version has matured, individual patch versions must be at least 3 days old before being suggested

## FAQs

### What happens if the datasource and/or registry does not provide a release timestamp?

Just like `minimumReleaseAge`, `minimumMinorAge` requires release timestamps to function. The behavior is controlled by `minimumReleaseAgeBehaviour`:

- **`timestamp-required` (default)**: Renovate will skip updates to minor versions that don't have a timestamp for their first release
- **`timestamp-optional`**: Renovate will allow updates to minor versions without timestamps (not recommended for security)

See [Minimum Release Age - FAQ on timestamps](./minimum-release-age.md#what-happens-if-the-datasource-andor-registry-does-not-provide-a-release-timestamp-when-using-minimumreleaseage) for more details.

### What happens when a minor version is not yet passing the minimum minor age checks?

Just like with `minimumReleaseAge`, Renovate will decide whether to create a branch based on [`internalChecksFilter`](../configuration-options.md#internalchecksfilter):

- **`internalChecksFilter=strict` (default)**: Branches are not created for minor versions that haven't matured yet
- **`internalChecksFilter=flexible`**: Branches may still be created

Updates that haven't met the minimum minor age requirement will appear in the Dependency Dashboard under "Pending Status Checks".

### Does minimumMinorAge work with all update types?

`minimumMinorAge` is designed primarily for minor and patch updates. It checks the maturity of the minor version and then allows updates to the latest patch within that minor version.

For major version updates, the check still applies but uses the major version as the grouping key.

### What happens to security updates?

Security updates bypass `minimumMinorAge` checks, just like they bypass `minimumReleaseAge` checks. Security updates will be raised as soon as Renovate detects them.

### Which datasources support release timestamps?

`minimumMinorAge` requires the same release timestamp support as `minimumReleaseAge`. See [Minimum Release Age - Which datasources support release timestamps?](./minimum-release-age.md#which-datasources-support-release-timestamps) for a list of supported datasources and registries.

## Example Configurations

### Conservative minor version adoption

```json
{
  "packageRules": [
    {
      "matchDatasources": ["npm"],
      "minimumMinorAge": "14 days"
    }
  ]
}
```

This waits 14 days after a new minor version is released before suggesting any updates to that minor version.

### Conservative minor adoption with quick patch updates

```json
{
  "packageRules": [
    {
      "matchDatasources": ["npm"],
      "minimumMinorAge": "14 days",
      "minimumReleaseAge": "1 day"
    }
  ]
}
```

This waits 14 days for minor versions to mature, but only 1 day for patch releases within a mature minor version.

### Different policies for production vs development dependencies

```json
{
  "packageRules": [
    {
      "matchDepTypes": ["dependencies"],
      "minimumMinorAge": "30 days"
    },
    {
      "matchDepTypes": ["devDependencies"],
      "minimumMinorAge": "7 days"
    }
  ]
}
```

This applies stricter policies to production dependencies while allowing faster updates to development dependencies.
