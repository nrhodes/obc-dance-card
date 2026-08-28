/**
 * Shared scalar aliases.
 *
 * `shared` stays free of any Firebase dependency, so timestamps are represented as
 * ISO-8601 strings on the wire. Cloud Functions convert to/from Firestore
 * `Timestamp` at the storage boundary; clients receive ISO strings.
 */

/** ISO-8601 date, no time component, e.g. `2027-01-12`. */
export type IsoDate = string;

/** ISO-8601 date-time in UTC, e.g. `2027-01-12T00:00:00.000Z`. */
export type IsoDateTime = string;

/** Local wall-clock time of day, 24h, e.g. `13:00`. */
export type TimeOfDay = string;

/** Firestore document id. */
export type Id = string;

/** Lower-cased email address, used as the natural key for a member. */
export type EmailLower = string;

/** Standard audit fields stamped on every mutable document. */
export interface Timestamps {
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
