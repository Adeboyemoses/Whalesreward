#!/usr/bin/env bash
# Creates the read-only product-docs symlink in the current checkout or worktree.
#   bash scripts/link-product-docs.sh            # uses the default path on Earl's Mac
#   WHR_PRODUCT_DOCS=/path/to/folder bash scripts/link-product-docs.sh
set -eu
target="${WHR_PRODUCT_DOCS:-/Users/earlsworkstation/Earls Cowork OS/Cloudrock/Clients/Whales Empire/Software Development/Fuel Station Loyalty}"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
link="$root/product-docs"
if [ -L "$link" ]; then echo "product-docs already links to: $(readlink "$link")"; exit 0; fi
[ -e "$link" ] && { echo "product-docs exists and is not a symlink; leaving it alone" >&2; exit 1; }
[ -d "$target" ] || { echo "product folder not found: $target (set WHR_PRODUCT_DOCS)" >&2; exit 1; }
ln -s "$target" "$link"
echo "linked product-docs -> $target"
