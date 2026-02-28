#!/bin/bash
#
# open-vault.sh - Obsidian Vault Manager
#
# Usage: open-vault.sh <vault-name|vault-path|vault-id>
#
# This script will:
# 1. Check if the vault is registered in Obsidian's config
# 2. If registered, open it
# 3. If not registered, register it with a random ID and open it
#

set -e

# Configuration
OBSIDIAN_CONFIG="$HOME/.config/obsidian/obsidian.json"
OBSIDIAN_CONFIG_BACKUP="$HOME/.config/obsidian/obsidian.json.backup"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Install it with: sudo apt install jq"
    exit 1
fi

# Check if parameter provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <vault-name|vault-path|vault-id>"
    echo ""
    echo "Examples:"
    echo "  $0 books-vault                    # Open by name"
    echo "  $0 /path/to/vault                 # Open by path"
    echo "  $0 e0c208e7b153aa0b               # Open by ID"
    exit 1
fi

INPUT="$1"

# Check if Obsidian config exists
if [ ! -f "$OBSIDIAN_CONFIG" ]; then
    echo -e "${RED}Error: Obsidian config not found at $OBSIDIAN_CONFIG${NC}"
    exit 1
fi

# Function to generate random vault ID
generate_vault_id() {
    openssl rand -hex 8
}

# Function to get absolute path
get_absolute_path() {
    local path="$1"
    if [ -d "$path" ]; then
        # CRITICAL: Use readlink/realpath instead of cd to avoid issues with set -e
        # The previous implementation with 'cd "$path" && pwd' could fail in set -e mode
        # Using readlink -f properly resolves relative paths to absolute paths
        if command -v readlink &> /dev/null; then
            readlink -f "$path"
        elif command -v realpath &> /dev/null; then
            realpath "$path"
        else
            (cd "$path" && pwd)
        fi
    else
        echo ""
    fi
}

# Function to get vault name from path
get_vault_name() {
    basename "$1"
}

# Function to check if vault is registered
check_vault_registered() {
    local input="$1"
    local result=""

    # Check if input is a vault ID (16 hex characters)
    if [[ "$input" =~ ^[a-f0-9]{16}$ ]]; then
        result=$(jq -r --arg id "$input" '.vaults[$id] // empty' "$OBSIDIAN_CONFIG")
        if [ -n "$result" ]; then
            echo "id:$input"
            return 0
        fi
    fi

    # Check if input is a path
    if [ -d "$input" ]; then
        local abs_path=$(get_absolute_path "$input")
        result=$(jq -r --arg path "$abs_path" '.vaults | to_entries[] | select(.value.path == $path) | .key' "$OBSIDIAN_CONFIG" | head -1)
        if [ -n "$result" ]; then
            echo "id:$result|path:$abs_path"
            return 0
        else
            echo "path:$abs_path"
            return 1
        fi
    fi

    # Check if input is a vault name
    # Try to find vault by matching the folder name
    result=$(jq -r --arg name "$input" '.vaults | to_entries[] | select(.value.path | split("/")[-1] == $name) | .key + "|" + .value.path' "$OBSIDIAN_CONFIG" | head -1)
    if [ -n "$result" ]; then
        local vault_id=$(echo "$result" | cut -d'|' -f1)
        local vault_path=$(echo "$result" | cut -d'|' -f2)
        echo "id:$vault_id|path:$vault_path|name:$input"
        return 0
    fi

    # Not found
    echo "name:$input"
    return 1
}

# Function to register vault
register_vault() {
    local vault_path="$1"
    local vault_id=$(generate_vault_id)
    local timestamp=$(date +%s)000

    echo -e "${YELLOW}Registering new vault...${NC}"
    echo "  Path: $vault_path"
    echo "  ID: $vault_id"

    # Backup config
    cp "$OBSIDIAN_CONFIG" "$OBSIDIAN_CONFIG_BACKUP"

    # Add vault to config
    jq --arg id "$vault_id" \
       --arg path "$vault_path" \
       --argjson ts "$timestamp" \
       '.vaults[$id] = {"path": $path, "ts": $ts, "open": true}' \
       "$OBSIDIAN_CONFIG" > "$OBSIDIAN_CONFIG.tmp" && \
       mv "$OBSIDIAN_CONFIG.tmp" "$OBSIDIAN_CONFIG"

    echo -e "${GREEN}✓ Vault registered successfully${NC}"
    echo "$vault_id"
}

# Function to open vault
open_vault() {
    local vault_id="$1"
    local vault_path="$2"
    local use_uri="${3:-false}"

    echo -e "${GREEN}Opening vault...${NC}"

    # CRITICAL: Different opening methods for registered vs unregistered vaults
    # This is what makes the script work efficiently for both cases
    if [ "$use_uri" = "true" ] && [ -n "$vault_id" ]; then
        # REGISTERED VAULTS: Use URI method (obsidian://open?vault=ID)
        # This switches vaults WITHOUT restarting Obsidian - fast and smooth!
        # Works even if Obsidian is already running with a different vault
        xdg-open "obsidian://open?vault=$vault_id" >/dev/null 2>&1 &
    elif [ -n "$vault_path" ]; then
        # UNREGISTERED VAULTS: Open by path
        # Used after registering a new vault and restarting Obsidian
        # Subshell ensures proper detachment from terminal
        (obsidian "$vault_path" >/dev/null 2>&1 &)
    else
        # Fallback to URI with ID
        xdg-open "obsidian://open?vault=$vault_id" >/dev/null 2>&1 &
    fi

    sleep 0.5
}

# Function to restart Obsidian
restart_obsidian() {
    echo -e "${YELLOW}Restarting Obsidian...${NC}"
    # CRITICAL: Use 'pkill -f' to match the full command line
    # Obsidian runs as an electron process, so 'pkill obsidian' won't work
    # We need to match the full path '/usr/lib/obsidian' in the process command
    pkill -f "/usr/lib/obsidian" 2>/dev/null || true
    pkill -f "obsidian" 2>/dev/null || true

    # Wait for processes to fully terminate before trying to restart
    # This ensures clean shutdown and prevents conflicts
    sleep 3
    echo -e "${GREEN}✓ Obsidian closed${NC}"
}

# Main logic
echo -e "${GREEN}=== Obsidian Vault Manager ===${NC}"
echo ""

# CRITICAL: Temporarily disable 'set -e' to prevent script exit on vault check failure
# When a vault is not registered, check_vault_registered returns 1, which would
# normally exit the script with 'set -e' enabled. We need to capture this return
# value to distinguish between registered and unregistered vaults.
set +e
vault_info=$(check_vault_registered "$INPUT")
vault_found=$?
set -e

if [ $vault_found -eq 0 ]; then
    # REGISTERED VAULT PATH
    # Vault exists in Obsidian's config - use fast URI switching
    echo -e "${GREEN}✓ Vault found in registry${NC}"

    vault_id=$(echo "$vault_info" | grep -oP 'id:\K[^|]+')
    vault_path=$(echo "$vault_info" | grep -oP 'path:\K[^|]+' || echo "")

    # CRITICAL: Pass "true" as third parameter to use URI method
    # This allows instant vault switching without restarting Obsidian
    # The URI method (obsidian://open?vault=ID) works even when Obsidian is running
    open_vault "$vault_id" "$vault_path" "true"
else
    # UNREGISTERED VAULT PATH
    # Vault doesn't exist in Obsidian's config - need to register it first
    # This requires: finding the vault, validating it, registering it, restarting Obsidian
    echo -e "${YELLOW}⚠ Vault not found in registry${NC}"

    # Determine the path (handles relative paths, absolute paths, or vault names)
    if [ -d "$INPUT" ]; then
        vault_path=$(get_absolute_path "$INPUT")
    else
        # Try to find vault in common locations
        possible_paths=(
            "$HOME/obsidian/$INPUT"
            "$HOME/Documents/$INPUT"
            "$HOME/Obsidian/$INPUT"
        )

        vault_path=""
        for path in "${possible_paths[@]}"; do
            if [ -d "$path" ]; then
                vault_path=$(get_absolute_path "$path")
                echo -e "${GREEN}Found vault at: $vault_path${NC}"
                break
            fi
        done

        if [ -z "$vault_path" ]; then
            echo -e "${RED}Error: Could not find vault '$INPUT'${NC}"
            echo "Please provide the full path to the vault."
            exit 1
        fi
    fi

    # Check if path has .obsidian folder (is a valid vault)
    if [ ! -d "$vault_path/.obsidian" ]; then
        echo -e "${RED}Error: '$vault_path' does not appear to be a valid Obsidian vault${NC}"
        echo "(.obsidian folder not found)"
        exit 1
    fi

    # CRITICAL: Workflow for unregistered vaults (different from registered)
    # 1. Register: Add vault to obsidian.json with new random ID
    vault_id=$(register_vault "$vault_path")

    # 2. Restart: Obsidian must be restarted to load the updated config
    #    Without this, Obsidian won't know about the new vault
    restart_obsidian

    # 3. Open: Now open the newly registered vault by path (NOT URI)
    #    We use path method here because Obsidian was just closed/restarted
    #    Note: Third parameter is NOT "true", so it uses path-based opening
    open_vault "$vault_id" "$vault_path"
fi

echo ""
echo -e "${GREEN}✓ Done!${NC}"