# Contributing to bosun and scollector

Bosun and scollector are open source projects. We appreciate your help.

## Contributing code

Use GitHub pull requests to submit code. General submission guidelines:

1. Use `gofmt`.
1. If using new third party packages, install party (`go get github.com/mjibson/party`) and run `party` in the root directory (`$GOPATH/src/scollector`) to vendor them and rewrite import paths.
1. Squash all commits into one. This may be done as the final step before merging.

Unless otherwise noted, the source files are distributed under the MIT license found in the LICENSE file.

### Style Guidelines
We use the golang [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments) document as the basis for our style. Take particular note of Error Strings, Mixed Caps, and Indent Error Flow sections. Also we don't have blank lines within functions.

### scollector submission guidelines

1. New scollector collectors must have units, types, and descriptions for all new metrics. Descriptions should not be in the Add line, but in another data structure or constant.