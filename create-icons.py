#!/usr/bin/env python3
"""
Simple script to create placeholder icons for the BugReel extension.
This creates basic colored squares with text since we don't have actual icon files.
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, filename):
    """Create a simple icon with the BugReel logo."""
    # Create a new image with a blue background
    image = Image.new('RGB', (size, size), color='#3498db')
    draw = ImageDraw.Draw(image)
    
    # Try to use a nice font, fallback to default
    try:
        # Try to use a system font
        font_size = max(size // 4, 12)
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        try:
            font = ImageFont.load_default()
        except:
            font = None
    
    # Draw the camera emoji/icon
    if size >= 32:
        # For larger icons, draw a camera-like symbol
        # Camera body
        body_margin = size // 8
        draw.rectangle([body_margin, body_margin + size//6, 
                       size - body_margin, size - body_margin], 
                      fill='#2c3e50', outline='#1a252f', width=2)
        
        # Camera lens
        lens_size = size // 3
        lens_center = size // 2
        draw.ellipse([lens_center - lens_size//2, lens_center - lens_size//2,
                     lens_center + lens_size//2, lens_center + lens_size//2],
                    fill='#34495e', outline='#1a252f', width=2)
        
        # Lens center
        center_size = size // 6
        draw.ellipse([lens_center - center_size//2, lens_center - center_size//2,
                     lens_center + center_size//2, lens_center + center_size//2],
                    fill='#95a5a6')
        
        # Viewfinder
        vf_size = size // 8
        draw.rectangle([size - body_margin - vf_size, body_margin,
                       size - body_margin, body_margin + vf_size],
                      fill='#95a5a6', outline='#1a252f', width=1)
    else:
        # For smaller icons, just draw a simple circle
        margin = size // 6
        draw.ellipse([margin, margin, size - margin, size - margin],
                    fill='#2c3e50', outline='#1a252f', width=1)
    
    # Save the image
    image.save(f'images/{filename}')
    print(f"Created {filename} ({size}x{size})")

def main():
    """Create all required icon sizes."""
    # Create images directory if it doesn't exist
    os.makedirs('images', exist_ok=True)
    
    # Create different icon sizes
    sizes = [
        (16, 'icon16.png'),
        (48, 'icon48.png'),
        (128, 'icon128.png')
    ]
    
    for size, filename in sizes:
        create_icon(size, filename)
    
    print("\nAll icons created successfully!")
    print("Icons are simple placeholders - you can replace them with your own designs.")

if __name__ == '__main__':
    main() 