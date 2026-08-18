package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const remoteImportDataVersionMetadataPrefix = "remote_import_data_version:"

// RemoteImportDataVersion returns the parser data version last imported from
// host into this physical archive generation. Zero means that no completed
// import has established the current archive's remote state.
func (db *DB) RemoteImportDataVersion(
	ctx context.Context, host string,
) (int, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	key, err := remoteImportDataVersionMetadataKey(host)
	if err != nil {
		return 0, err
	}
	var raw string
	err = db.getReader().QueryRowContext(ctx,
		`SELECT value FROM archive_metadata WHERE key = ?`, key,
	).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf(
			"reading remote import data version for %s: %w", host, err,
		)
	}
	version, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || version <= 0 {
		return 0, fmt.Errorf(
			"invalid remote import data version %q for %s", raw, host,
		)
	}
	return version, nil
}

// SetRemoteImportDataVersion records a completed remote import in the current
// physical archive generation.
func (db *DB) SetRemoteImportDataVersion(
	ctx context.Context, host string, version int,
) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := db.requireWritable(); err != nil {
		return err
	}
	key, err := remoteImportDataVersionMetadataKey(host)
	if err != nil {
		return err
	}
	if version <= 0 {
		return fmt.Errorf("invalid remote import data version %d", version)
	}

	db.mu.Lock()
	defer db.mu.Unlock()
	if _, err := db.getWriter().ExecContext(ctx, `
		INSERT INTO archive_metadata (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
		key, strconv.Itoa(version),
	); err != nil {
		return fmt.Errorf(
			"recording remote import data version for %s: %w", host, err,
		)
	}
	return nil
}

func remoteImportDataVersionMetadataKey(host string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", errors.New("remote import host is empty")
	}
	return remoteImportDataVersionMetadataPrefix + host, nil
}
