import * as pg from './schema-pg';
import * as sqlite from './schema-sqlite';
import { usePostgres } from './dialect';

const S = usePostgres() ? pg : sqlite;

export const users = S.users;
export const passwordResetTokens = S.passwordResetTokens;
export const accounts = S.accounts;
export const sessions = S.sessions;
export const verificationTokens = S.verificationTokens;
export const handoffComponents = S.handoffComponents;
export const handoffPatterns = S.handoffPatterns;
export const handoffDesignArtifacts = S.handoffDesignArtifacts;
export const handoffTokensSnapshots = S.handoffTokensSnapshots;
export const editHistory = S.editHistory;
export const handoffEventLog = S.handoffEventLog;
export const componentBuildJobs = S.componentBuildJobs;
export const figmaFetchJobs = S.figmaFetchJobs;
export const handoffPages = S.handoffPages;
export const syncEvents = S.syncEvents;
export const handoffReferenceMaterials = S.handoffReferenceMaterials;
export const componentGenerationJobs = S.componentGenerationJobs;
