#!/usr/bin/env bash

# Usage: ./run-all.sh examples
#        ./run-all.sh examples/

if [ $# -ne 1 ]; then
    echo "Usage: $0 <folder_path>"
    echo "Example: $0 examples"
    exit 1
fi

FOLDER="$1"

# Remove trailing slash if present
FOLDER="${FOLDER%/}"

if [ ! -d "$FOLDER" ]; then
    echo "Error: Directory '$FOLDER' does not exist"
    exit 1
fi

# Find all files (not directories) in the folder (only one level deep)
# mapfile -t files < <(find "$FOLDER" -maxdepth 1 -type f | sort)
files=($(find "$FOLDER" -maxdepth 1 -type f | sort))

if [ ${#files[@]} -eq 0 ]; then
    echo "No files found in $FOLDER"
    exit 0
fi

echo "Found ${#files[@]} files in $FOLDER"
echo "Will run: bun run <filename> for each file"
echo

for file in "${files[@]}"; do
    filename=$(basename "$file")
    
    echo "═══════════════════════════════════════════════════════════════"
    echo "Next file: $filename"
    echo "Path:     $file"
    echo "Command:  bun run $file "
    echo "═══════════════════════════════════════════════════════════════"
    
    read -p "Press Enter to run this file... (or Ctrl+C to quit) " dummy
    
    echo
    echo "Running: bun run $filename"
    echo "───────────────────────────────────────────────────────────────"
    
    # Run the file
   
    bun run "$file"
    
    echo
    echo "───────────────────────────────────────────────────────────────"
    echo "Finished: $filename"
    echo
done

echo "All done! Processed ${#files[@]} file(s)."