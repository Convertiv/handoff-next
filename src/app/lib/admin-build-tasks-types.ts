/** Unified row for the admin Builds dashboard (no server imports — safe for client). */
export type AdminBuildTaskRow =
  | {
      kind: 'component_build';
      jobId: number;
      componentId: string;
      status: string;
      error: string | null;
      createdAt: Date | string | null;
      completedAt: Date | string | null;
    }
  | {
      kind: 'design_asset_extraction';
      artifactId: string;
      title: string;
      status: string;
      error: string | null;
      createdAt: Date | string | null;
      updatedAt: Date | string | null;
    }
  | {
      kind: 'component_generation';
      generationJobId: number;
      artifactId: string;
      componentId: string;
      status: string;
      error: string | null;
      createdAt: Date | string | null;
      completedAt: Date | string | null;
      iteration: number;
      visualScore: number | null;
    };
