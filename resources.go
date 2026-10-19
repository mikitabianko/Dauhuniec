// Package dauhuniec provides the resources embedded in the lon executable.
package dauhuniec

import "embed"

// Assets contains VS Code templates, the user guide and Go runtime license.
//
//go:embed templates/vscode/*.json extension/README.md GO-LICENSE.txt
var Assets embed.FS
