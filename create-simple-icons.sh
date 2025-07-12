#!/bin/bash

# Create simple PNG files for the extension icons
echo "Creating simple PNG icons..."

# Create a 1x1 pixel PNG file using base64 encoding
# This is the minimal valid PNG file data
create_png() {
    local size=$1
    local filename=$2
    
    # Create a minimal PNG (1x1 transparent pixel)
    echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > "images/$filename"
    echo "Created $filename (${size}x${size})"
}

# Create all required icon sizes
create_png 16 "icon16.png"
create_png 48 "icon48.png"
create_png 128 "icon128.png"

echo "All icons created successfully!"
echo "Note: These are minimal 1x1 pixel icons. You can replace them with proper icons later." 