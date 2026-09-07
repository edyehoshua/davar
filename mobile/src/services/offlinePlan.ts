export type BundleVersions = Record<string, number>;

export type BundleUpdatePlan = {
  translationDataset: "tth" | null;
  needs: {
    tanaj: boolean;
    besorah: boolean;
    translation: boolean;
    dictionary: boolean;
    dss: boolean;
  };
};

export const getBundleUpdatePlan = (
  language: "es" | "en",
  localVersions: BundleVersions,
  remoteVersions: BundleVersions,
): BundleUpdatePlan => {
  // TS2009 is served as static chapter JSON and is intentionally online-only.
  const translationDataset = language === "es" ? "tth" : null;

  return {
    translationDataset,
    needs: {
      tanaj: (remoteVersions.tanaj ?? 0) > (localVersions.tanaj ?? 0),
      besorah: (remoteVersions.besorah ?? 0) > (localVersions.besorah ?? 0),
      translation:
        translationDataset !== null &&
        (remoteVersions[translationDataset] ?? 0) >
          (localVersions[translationDataset] ?? 0),
      dictionary:
        (remoteVersions.dictionary ?? 0) > (localVersions.dictionary ?? 0),
      dss: (remoteVersions.dss ?? 0) > (localVersions.dss ?? 0),
    },
  };
};
