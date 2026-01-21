---
title: Branch Processing vs. Release Filtering Architecture
description: Understanding the difference between release filtering and branch processing phases
---

# Branch Processing vs. Release Filtering Architecture

## Overview

Renovate's update workflow is split into two main phases:
1. **Release Filtering Phase** (`lib/workers/repository/process/lookup/filter-checks.ts`)
2. **Branch Processing Phase** (`lib/workers/repository/update/branch/index.ts`)

Understanding the difference between these phases is crucial for implementing features like `minimumReleaseAge` and `minimumMinorAge`.

## Release Filtering Phase (`filter-checks.ts`)

### Purpose

The filtering phase is responsible for **selecting which version** of a dependency should be used for an update. It has access to:
- **All available releases** from the registry/datasource
- Version metadata (release timestamps, version numbers)
- The ability to compare and analyze the entire release history

### What it does

```typescript
filterInternalChecks(
  config,
  versioningApi,
  bucket,
  sortedReleases  // ALL releases available
): Promise<InternalChecksResult>
```

1. Iterates through all available releases (from newest to oldest)
2. Applies filtering rules like:
   - `minimumReleaseAge` - checks if individual release is old enough
   - `minimumMinorAge` - checks if the minor version series is old enough
   - `minimumConfidence` - checks merge confidence levels
3. Returns the **best matching release** that passes all filters

### Key Characteristics

- ✅ Has access to complete release history
- ✅ Can build maps of version relationships (e.g., first release per minor version)
- ✅ Can compare multiple releases to make decisions
- ✅ Runs once per dependency during lookup phase

## Branch Processing Phase (`branch/index.ts`)

### Purpose

The branch processing phase is responsible for **creating or updating a git branch** with the selected updates. By this point, the version selection has already been made. It handles:
- Branch creation/updates
- File modifications
- Commit creation
- PR creation/updates
- **Status checks** (setting green/yellow status based on stability requirements)

### What it does

```typescript
processBranch(
  branchConfig: BranchConfig  // Contains SELECTED upgrades only
): Promise<ProcessBranchResult>
```

The `branchConfig.upgrades` array contains upgrades that have **already been filtered** by the lookup phase. Each upgrade object contains:
- Selected version (e.g., `newVersion: "1.1.3"`)
- Release timestamp of the selected version
- But **NOT** the full release history

### Key Characteristics

- ❌ Does NOT have access to all releases
- ❌ Cannot determine "first release of a minor version" 
- ✅ Can check individual upgrade timestamps
- ✅ Sets stability status checks (green/yellow) for the PR
- ✅ Runs once per branch (may contain multiple upgrades)

## Why `minimumReleaseAge` Needs Both Phases

### In Filter Phase (`filter-checks.ts`)

```typescript
// Skip releases that don't meet the age requirement
if (getElapsedMs(candidateRelease.releaseTimestamp) < minimumReleaseAgeMs) {
  pendingReleases.unshift(candidateRelease);
  continue; // Skip this release, try older one
}
```

**Purpose**: Filter out releases that are too new

### In Branch Phase (`branch/index.ts`)

```typescript
// Set status check to "pending" if upgrade is too new
if (upgrade.releaseTimestamp) {
  const timeElapsed = getElapsedMs(upgrade.releaseTimestamp);
  if (timeElapsed < minimumReleaseAgeMs) {
    config.stabilityStatus = 'yellow';  // Pending
  }
}
```

**Purpose**: Set a "pending" status check on the PR to indicate the upgrade hasn't fully matured yet

### Why both?

Even though filtering happens first, the branch phase needs to re-check because:
1. Time has passed between filtering and branch processing
2. Multiple packages in one branch may have different stability statuses
3. Status checks are set at the **branch level**, not during filtering

## Why `minimumMinorAge` Only Needs Filter Phase

### The Key Difference

`minimumMinorAge` requires information that is **only available during the filter phase**:

```typescript
// In filter-checks.ts - we can build this map
const minorVersionFirstRelease = new Map<string, Release>();
for (const rel of sortedReleases) {  // ALL releases available
  const major = versioningApi.getMajor(rel.version);
  const minor = versioningApi.getMinor(rel.version);
  const minorKey = `${major}.${minor}`;
  if (!minorVersionFirstRelease.has(minorKey)) {
    minorVersionFirstRelease.set(minorKey, rel);  // First release of this minor
  }
}
```

### Why Not in Branch Phase?

In `branch/index.ts`, we only have:
- `upgrade.releaseTimestamp` - timestamp of the **selected version** (e.g., 1.1.3)
- `upgrade.newMajor`, `upgrade.newMinor` - version numbers

But we **don't know**:
- When was version 1.1.0 (first of the 1.1.x series) released?
- What other versions exist in the 1.1.x series?

### Example Scenario

Given:
- 1.1.0 released Aug 1 (first of 1.1.x series)
- 1.1.3 released Aug 8 (selected upgrade)
- `minimumMinorAge: "7 days"`
- Current date: Aug 9

**In filter phase:**
```typescript
// We can determine: 1.1.0 was released on Aug 1 (8 days ago)
// Check passes: 8 days >= 7 days ✅
// Select 1.1.3 as the upgrade
```

**In branch phase (if we had the logic):**
```typescript
// We only know: 1.1.3 was released on Aug 8 (1 day ago)
// Check fails: 1 day < 7 days ❌  (WRONG!)
// We'd incorrectly mark as pending
```

This is why the original implementation in commit `277890a` was **incorrect** - it used `upgrade.releaseTimestamp` (the current patch release) instead of the first minor release timestamp.

## Summary Table

| Feature | Filter Phase | Branch Phase | Why? |
|---------|--------------|--------------|------|
| **minimumReleaseAge** | ✅ Required | ✅ Required | Filter phase selects version; branch phase sets status check |
| **minimumMinorAge** | ✅ Required | ❌ Not needed | Needs full release history to find first minor release; filtering is sufficient |
| **minimumConfidence** | ✅ Required | ✅ Required | Similar to minimumReleaseAge - needs status check |

## Architecture Decision

For `minimumMinorAge`:
- ✅ **Filter phase only**: Has access to all releases, can determine first minor release timestamp
- ❌ **No branch phase logic**: Cannot accurately determine minor version age from selected upgrade alone
- ℹ️ **Status check reuse**: Uses the same `stabilityStatus` mechanism as `minimumReleaseAge`

This architectural decision keeps the implementation clean, accurate, and maintainable by placing logic where the necessary data is available.

## Code References

- **Filter Phase**: `lib/workers/repository/process/lookup/filter-checks.ts` (lines 54-67, 144-196)
- **Branch Phase**: `lib/workers/repository/update/branch/index.ts` (lines 385-448)
- **Status Checks**: `lib/workers/repository/update/branch/status-checks.ts` (lines 70-100)
