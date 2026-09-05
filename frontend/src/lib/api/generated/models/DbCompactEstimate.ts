/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DbCompactEstimate = {
  database_bytes: number;
  estimated_database_bytes: number;
  estimated_reclaim_bytes: number;
  freelist_bytes: number;
  freelist_count: number;
  page_count: number;
  page_size: number;
  shm_bytes: number;
  staging_required_bytes: number;
  total_bytes: number;
  wal_bytes: number;
};
