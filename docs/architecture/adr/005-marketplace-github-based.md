# ADR-005: GitHub-Based Marketplace

## Status
Accepted

## Context
Extensions need a discovery and distribution mechanism. Options range from a full registry (like npm) to a simple file-based approach.

Options considered:
1. **Custom registry service** — hosted API with auth, search, versioning
2. **npm registry** — publish extensions as npm packages
3. **GitHub-based** — a single repo with a JSON index, extensions in separate repos

## Decision
**The marketplace is a JSON file (`marketplace.json`) hosted in the RenRe Kit GitHub repository.** Each entry points to a separate GitHub repository containing the extension. The CLI fetches this index, caches it locally, and downloads extensions by cloning their repos.

Repository structure:
```
github.com/x/renre-kit/
  .renre-kit/
    marketplace.json    # [{name, version, description, repository, tags}]
```

## Consequences

### Positive
- Zero infrastructure cost — no servers to maintain
- Familiar model — GitHub repos for extensions, PRs to add to marketplace
- Easy to fork for private/enterprise marketplaces
- Extensions benefit from GitHub features (issues, releases, CI)

### Negative
- No automatic versioning or conflict resolution
- Search is limited to what's in the JSON index
- Rate limits on GitHub API for unauthenticated requests
- No download counts or ratings

### Mitigations
- CLI caches marketplace index with TTL (avoids excessive fetches)
- Extensions use git tags for versioning
- Future: add GitHub API token support for higher rate limits
- Future: add a web-based marketplace browser
