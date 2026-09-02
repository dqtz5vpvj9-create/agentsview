/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DbCompactEstimate } from './DbCompactEstimate';
export type DbCompactResult = {
  after: DbCompactEstimate;
  backup_path?: string;
  before: DbCompactEstimate;
  duration_millis: number;
  reclaimed_bytes: number;
};
