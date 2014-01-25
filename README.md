
## ClusterManager -- A cluster manager for Google Maps API v3

This library creates and manages clusters for Google Maps API v3. It does two things to make maps with large numbers of markers more useable: 1) Combines markers in close proximity to each other based on zoom level into clusters, 2) Only adds markers in the current viewport (and optional padding) to the map. 

### How it works
The manager sets up a dictionary for clusters and a dictionary for markers. Every marker that's added to the manager has a string created based on it's latitude, longitude, and zoom level and that's used to add it to the cluster dictionary. Nearby markers will hash to the same string so nothing has to be calculated. Nearby clusters are then combined. Markers can be added with optional type and subtypes so subsets of markers can be shown and hidden. Markers with the same subtype will still be clustered together, but can be shown or hidden separately. Markers with the same type will be clustered together and can also be hidden or shown separately. The function used to create the clusters is stored and this function can be overridden for greater control of the look and/or behavior of the clusters for each marker type.

### Author:
Marcus Ulrich

### Licence

The MIT License (MIT)

Copyright (c) 2014 Marcus Ulrich

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
