package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const simpleFTSDirEnv = "AGENTSVIEW_SIMPLE_DIR"

var simpleFTSRuntimeConfig, simpleFTSRuntimeErr = discoverSimpleFTSRuntime()

type simpleFTSRuntime struct {
	libraryPath    string
	dictionaryPath string
}

func (r simpleFTSRuntime) available() bool {
	return r.libraryPath != "" && r.dictionaryPath != ""
}

func discoverSimpleFTSRuntime() (simpleFTSRuntime, error) {
	exe, err := os.Executable()
	if err != nil {
		return simpleFTSRuntime{}, fmt.Errorf(
			"discovering simple FTS5 extension: executable path: %w", err,
		)
	}
	return discoverSimpleFTSRuntimeFrom(exe, os.Getenv(simpleFTSDirEnv), runtime.GOOS)
}

func discoverSimpleFTSRuntimeFrom(
	executable, explicitDir, goos string,
) (simpleFTSRuntime, error) {
	libraryName, err := simpleFTSLibraryName(goos)
	if err != nil {
		return simpleFTSRuntime{}, err
	}
	if explicitDir != "" {
		found, validationErr := validateSimpleFTSDir(explicitDir, libraryName)
		if validationErr != nil {
			return simpleFTSRuntime{}, fmt.Errorf(
				"%s=%q: %w", simpleFTSDirEnv, explicitDir, validationErr,
			)
		}
		return found, nil
	}

	exeDir := filepath.Dir(executable)
	candidates := []string{
		filepath.Join(exeDir, "agentsview-simple"),
		filepath.Clean(filepath.Join(
			exeDir, "..", "lib", "agentsview", "simple",
		)),
	}
	for _, candidate := range candidates {
		found, validationErr := validateSimpleFTSDir(candidate, libraryName)
		if validationErr == nil {
			return found, nil
		}
	}
	return simpleFTSRuntime{}, nil
}

func simpleFTSLibraryName(goos string) (string, error) {
	switch goos {
	case "linux":
		return "libsimple.so", nil
	case "darwin":
		return "libsimple.dylib", nil
	case "windows":
		return "simple.dll", nil
	default:
		return "", fmt.Errorf(
			"simple FTS5 does not support %s", goos,
		)
	}
}

func validateSimpleFTSDir(dir, libraryName string) (simpleFTSRuntime, error) {
	libraryPath := filepath.Join(dir, libraryName)
	if err := requireRegularFile(libraryPath); err != nil {
		return simpleFTSRuntime{}, err
	}
	dictionaryPath := filepath.Join(dir, "dict")
	for _, name := range []string{
		"hmm_model.utf8",
		"idf.utf8",
		"jieba.dict.utf8",
		"stop_words.utf8",
		"user.dict.utf8",
	} {
		if err := requireRegularFile(filepath.Join(dictionaryPath, name)); err != nil {
			return simpleFTSRuntime{}, err
		}
	}
	return simpleFTSRuntime{
		libraryPath:    libraryPath,
		dictionaryPath: dictionaryPath,
	}, nil
}

func requireRegularFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("required file %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("required file %s is not a regular file", path)
	}
	return nil
}

func checkSimpleFTSRuntimeConfig() error {
	return simpleFTSRuntimeErr
}

func installChineseFTSTriggers(conn *sql.DB) error {
	if !simpleFTSRuntimeConfig.available() {
		return nil
	}
	var count int
	if err := conn.QueryRow(
		"SELECT count(*) FROM sqlite_master" +
			" WHERE type='table' AND name='messages_chinese_fts'",
	).Scan(&count); err != nil {
		return fmt.Errorf("checking Chinese FTS table: %w", err)
	}
	if count == 0 {
		return nil
	}
	if _, err := conn.Exec(schemaChineseFTSTriggers); err != nil {
		return fmt.Errorf("installing Chinese FTS triggers: %w", err)
	}
	return nil
}
