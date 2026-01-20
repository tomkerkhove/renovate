import type {
  GetReleasesConfig,
  PostprocessReleaseConfig,
  PostprocessReleaseResult,
  Release,
  ReleaseResult,
} from '../../../../modules/datasource';
import * as _datasourceCommon from '../../../../modules/datasource/common';
import { Datasource } from '../../../../modules/datasource/datasource';
import * as allVersioning from '../../../../modules/versioning';
import { clone } from '../../../../util/clone';
import * as _dateUtil from '../../../../util/date';
import * as _mergeConfidence from '../../../../util/merge-confidence';
import { toMs } from '../../../../util/pretty-time';
import type { Timestamp } from '../../../../util/timestamp';
import { filterInternalChecks } from './filter-checks';
import type { LookupUpdateConfig, UpdateResult } from './types';

vi.mock('../../../../util/date');
const dateUtil = vi.mocked(_dateUtil);

vi.mock('../../../../util/merge-confidence');
const mergeConfidence = vi.mocked(_mergeConfidence);

vi.mock('../../../../modules/datasource/common');
const { getDatasourceFor } = vi.mocked(_datasourceCommon);

class DummyDatasource extends Datasource {
  constructor() {
    super('some-datasource');
  }

  override getReleases(_: GetReleasesConfig): Promise<ReleaseResult | null> {
    return Promise.resolve(null);
  }
}

let config: Partial<LookupUpdateConfig & UpdateResult>;

const versioning = allVersioning.get('semver');

const releases: Release[] = [
  {
    version: '1.0.1',
    releaseTimestamp: '2021-01-01T00:00:01.000Z' as Timestamp,
  },
  {
    version: '1.0.2',
    releaseTimestamp: '2021-01-03T00:00:00.000Z' as Timestamp,
  },
  {
    version: '1.0.3',
    releaseTimestamp: '2021-01-05T00:00:00.000Z' as Timestamp,
  },
  {
    version: '1.0.4',
    releaseTimestamp: '2021-01-07T00:00:00.000Z' as Timestamp,
  },
];

describe('workers/repository/process/lookup/filter-checks', () => {
  let sortedReleases: Release[];

  beforeEach(() => {
    config = { currentVersion: '1.0.0' };
    sortedReleases = clone(releases);
    dateUtil.getElapsedMs.mockReturnValueOnce(toMs('3 days') ?? 0);
    dateUtil.getElapsedMs.mockReturnValueOnce(toMs('5 days') ?? 0);
    dateUtil.getElapsedMs.mockReturnValueOnce(toMs('7 days') ?? 0);
    dateUtil.getElapsedMs.mockReturnValueOnce(toMs('9 days') ?? 0);
  });

  describe('.filterInternalChecks()', () => {
    it('returns latest release if internalChecksFilter=none', async () => {
      config.internalChecksFilter = 'none';
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(0);
      expect(res.release?.version).toBe('1.0.4');
    });

    it('uses datasource-level interception mechanism', async () => {
      config.datasource = 'some-datasource';
      config.packageName = 'some-package';
      config.internalChecksFilter = 'strict';

      class SomeDatasource extends DummyDatasource {
        override postprocessRelease(
          _: PostprocessReleaseConfig,
          release: Release,
        ): Promise<PostprocessReleaseResult> {
          if (release.version !== '1.0.2') {
            return Promise.resolve('reject');
          }

          release.isStable = true;
          return Promise.resolve(release);
        }
      }
      getDatasourceFor.mockReturnValue(new SomeDatasource());

      const { release } = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );

      expect(release).toEqual({
        version: '1.0.2',
        releaseTimestamp: '2021-01-03T00:00:00.000Z',
        isStable: true,
      });
    });

    it('returns non-pending latest release if internalChecksFilter=flexible and none pass checks', async () => {
      config.internalChecksFilter = 'flexible';
      config.minimumReleaseAge = '10 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(0);
      expect(res.release?.version).toBe('1.0.4');
    });

    it('returns pending latest release if internalChecksFilter=strict and none pass checks', async () => {
      config.internalChecksFilter = 'strict';
      config.minimumReleaseAge = '10 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeTrue();
      expect(res.pendingReleases).toHaveLength(0);
      expect(res.release?.version).toBe('1.0.4');
    });

    it('returns non-latest release if internalChecksFilter=strict and some pass checks', async () => {
      config.internalChecksFilter = 'strict';
      config.minimumReleaseAge = '6 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(2);
      expect(res.release?.version).toBe('1.0.2');
    });

    it('returns non-latest release if internalChecksFilter=flexible and some pass checks', async () => {
      config.internalChecksFilter = 'flexible';
      config.minimumReleaseAge = '6 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(2);
      expect(res.release?.version).toBe('1.0.2');
    });

    it('picks up minimumReleaseAge settings from packageRules', async () => {
      config.internalChecksFilter = 'strict';
      config.minimumReleaseAge = '6 days';
      config.packageRules = [
        { matchUpdateTypes: ['patch'], minimumReleaseAge: '1 day' },
      ];
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(0);
      expect(res.release?.version).toBe('1.0.4');
    });

    it('picks up minimumReleaseAge settings from updateType', async () => {
      config.internalChecksFilter = 'strict';
      config.patch = { minimumReleaseAge: '4 days' };
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(1);
      expect(res.release?.version).toBe('1.0.3');
    });

    describe('if internalChecksFilter=strict, minimumReleaseAge is specified, and the latest release does not have a releaseTimestamp', () => {
      beforeEach(() => {
        // NOTE that we need to reset the existing test set up to make sure that we call `getElapsedMs` in the right order
        dateUtil.getElapsedMs.mockReset();
        // NOTE that we do NOT want to return 3 days, as we want the first release that has a timestamp (1.0.3) to be within the `minimumReleaseAge=4 days`
        dateUtil.getElapsedMs.mockReturnValueOnce(toMs('5 days') ?? 0);
        dateUtil.getElapsedMs.mockReturnValueOnce(toMs('7 days') ?? 0);
        dateUtil.getElapsedMs.mockReturnValueOnce(toMs('9 days') ?? 0);
      });

      it('does not return the latest release, if minimumReleaseAgeBehaviour=timestamp-required', async () => {
        const releasesWithMissingReleaseTimestamp: Release[] = [
          {
            version: '1.0.1',
            releaseTimestamp: '2021-01-01T00:00:01.000Z' as Timestamp,
          },
          {
            version: '1.0.2',
            releaseTimestamp: '2021-01-03T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.3',
            releaseTimestamp: '2021-01-05T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.4',
            // no releaseTimestamp
          },
        ];

        config.internalChecksFilter = 'strict';
        config.minimumReleaseAge = '4 days';
        config.minimumReleaseAgeBehaviour = 'timestamp-required';
        const res = await filterInternalChecks(
          config,
          versioning,
          'patch',
          releasesWithMissingReleaseTimestamp,
        );
        expect(res.pendingChecks).toBeFalse();
        expect(res.pendingReleases).toHaveLength(1);
        expect(res.release?.version).toBe('1.0.3');
      });

      it('returns the latest release, if minimumReleaseAgeBehaviour=timestamp-optional', async () => {
        const releasesWithMissingReleaseTimestamp: Release[] = [
          {
            version: '1.0.1',
            releaseTimestamp: '2021-01-01T00:00:01.000Z' as Timestamp,
          },
          {
            version: '1.0.2',
            releaseTimestamp: '2021-01-03T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.3',
            releaseTimestamp: '2021-01-05T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.4',
            // no releaseTimestamp
          },
        ];

        config.internalChecksFilter = 'strict';
        config.minimumReleaseAge = '100 days';
        config.minimumReleaseAgeBehaviour = 'timestamp-optional';
        const res = await filterInternalChecks(
          config,
          versioning,
          'patch',
          releasesWithMissingReleaseTimestamp,
        );
        expect(res.pendingChecks).toBeFalse();
        expect(res.pendingReleases).toHaveLength(0);
        expect(res.release?.version).toBe('1.0.4');
      });

      it('returns latest release, if minimumReleaseAgeBehaviour=timestamp-required but minimumReleaseAge=0 days', async () => {
        const releasesWithMissingReleaseTimestamp: Release[] = [
          {
            version: '1.0.1',
            releaseTimestamp: '2021-01-01T00:00:01.000Z' as Timestamp,
          },
          {
            version: '1.0.2',
            releaseTimestamp: '2021-01-03T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.3',
            releaseTimestamp: '2021-01-05T00:00:00.000Z' as Timestamp,
          },
          {
            version: '1.0.4',
            // no releaseTimestamp
          },
        ];

        config.internalChecksFilter = 'strict';
        config.minimumReleaseAge = '0 days';
        config.minimumReleaseAgeBehaviour = 'timestamp-required';
        const res = await filterInternalChecks(
          config,
          versioning,
          'patch',
          releasesWithMissingReleaseTimestamp,
        );
        expect(res.pendingChecks).toBeFalse();
        expect(res.pendingReleases).toHaveLength(0);
        expect(res.release?.version).toBe('1.0.4');
      });
    });

    it('picks up minimumConfidence settings from updateType', async () => {
      config.internalChecksFilter = 'strict';
      config.minimumConfidence = 'high';
      mergeConfidence.isActiveConfidenceLevel.mockReturnValue(true);
      mergeConfidence.satisfiesConfidenceLevel.mockReturnValueOnce(false);
      mergeConfidence.satisfiesConfidenceLevel.mockReturnValueOnce(false);
      mergeConfidence.satisfiesConfidenceLevel.mockReturnValueOnce(false);
      mergeConfidence.satisfiesConfidenceLevel.mockReturnValueOnce(true);
      const res = await filterInternalChecks(
        config,
        versioning,
        'patch',
        sortedReleases,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(3);
      expect(res.release?.version).toBe('1.0.1');
    });

    it('filters releases based on minimumMinorAge - minor not mature', async () => {
      dateUtil.getElapsedMs.mockReset();
      // Mock elapsed time for the first release of each minor version
      // 1.0.0 - 31 days old (matured)
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('31 days') ?? 0);
      // 1.1.0 - 1 day old (not matured)
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('1 day') ?? 0);

      const releasesWithMinorVersions: Release[] = [
        {
          version: '1.0.0',
          releaseTimestamp: '2021-07-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.0',
          releaseTimestamp: '2021-08-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.1',
          releaseTimestamp: '2021-08-02T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.3',
          releaseTimestamp: '2021-08-08T00:00:00.000Z' as Timestamp,
        },
      ];

      config.internalChecksFilter = 'strict';
      config.minimumMinorAge = '7 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'minor',
        releasesWithMinorVersions,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(3);
      expect(res.release?.version).toBe('1.0.0');
    });

    it('filters releases based on minimumMinorAge - minor is mature', async () => {
      dateUtil.getElapsedMs.mockReset();
      // Mock elapsed time for the first release of each minor version
      // 1.0.0 - 40 days old (matured)
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('40 days') ?? 0);
      // 1.1.0 - 8 days old (matured)
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('8 days') ?? 0);

      const releasesWithMinorVersions: Release[] = [
        {
          version: '1.0.0',
          releaseTimestamp: '2021-07-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.0',
          releaseTimestamp: '2021-08-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.1',
          releaseTimestamp: '2021-08-02T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.3',
          releaseTimestamp: '2021-08-08T00:00:00.000Z' as Timestamp,
        },
      ];

      config.internalChecksFilter = 'strict';
      config.minimumMinorAge = '7 days';
      const res = await filterInternalChecks(
        config,
        versioning,
        'minor',
        releasesWithMinorVersions,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(0);
      expect(res.release?.version).toBe('1.1.3');
    });

    it('filters releases with minimumMinorAge when first release has no timestamp and minimumReleaseAgeBehaviour=timestamp-required', async () => {
      const releasesWithMissingTimestamp: Release[] = [
        {
          version: '1.0.0',
          releaseTimestamp: '2021-07-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.0',
          // no releaseTimestamp
        },
        {
          version: '1.1.1',
          releaseTimestamp: '2021-08-02T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.3',
          releaseTimestamp: '2021-08-08T00:00:00.000Z' as Timestamp,
        },
      ];

      config.internalChecksFilter = 'strict';
      config.minimumMinorAge = '7 days';
      config.minimumReleaseAgeBehaviour = 'timestamp-required';
      const res = await filterInternalChecks(
        config,
        versioning,
        'minor',
        releasesWithMissingTimestamp,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(3);
      expect(res.release?.version).toBe('1.0.0');
    });

    it('allows minimumMinorAge and minimumReleaseAge to work together', async () => {
      dateUtil.getElapsedMs.mockReset();
      // Mock elapsed time checks
      // For minimumMinorAge - 1.0.0 first release
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('40 days') ?? 0);
      // For minimumMinorAge - 1.1.0 first release
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('10 days') ?? 0);
      // For minimumReleaseAge - 1.1.3 individual release
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('3 days') ?? 0);
      // For minimumReleaseAge - 1.1.1 individual release
      dateUtil.getElapsedMs.mockReturnValueOnce(toMs('9 days') ?? 0);

      const releasesWithBothChecks: Release[] = [
        {
          version: '1.0.0',
          releaseTimestamp: '2021-07-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.0',
          releaseTimestamp: '2021-08-01T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.1',
          releaseTimestamp: '2021-08-02T00:00:00.000Z' as Timestamp,
        },
        {
          version: '1.1.3',
          releaseTimestamp: '2021-08-08T00:00:00.000Z' as Timestamp,
        },
      ];

      config.internalChecksFilter = 'strict';
      config.minimumMinorAge = '7 days'; // Minor 1.1.x is mature (10 days)
      config.minimumReleaseAge = '5 days'; // But 1.1.3 is only 3 days old
      const res = await filterInternalChecks(
        config,
        versioning,
        'minor',
        releasesWithBothChecks,
      );
      expect(res.pendingChecks).toBeFalse();
      expect(res.pendingReleases).toHaveLength(1);
      expect(res.release?.version).toBe('1.1.1');
    });
  });
});
