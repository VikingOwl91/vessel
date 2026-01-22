## Contributing

Thanks for your interest in Vessel.

### Where to Contribute

- **Issues**: Open on GitHub at https://github.com/VikingOwl91/vessel
- **Pull Requests**: Submit via GitHub (for external contributors) or Gitea (for maintainers)

### Branching Strategy

```
main          (protected - releases only)
  └── dev     (default development branch)
       └── feature/your-feature
       └── fix/bug-description
```

- **main**: Production releases only. No direct pushes allowed.
- **dev**: Active development. All changes merge here first.
- **feature/***: New features, branch from `dev`
- **fix/***: Bug fixes, branch from `dev`

### Workflow

1. **Fork** the repository (external contributors)
2. **Clone** and switch to dev:
   ```bash
   git clone https://github.com/VikingOwl91/vessel.git
   cd vessel
   git checkout dev
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature
   ```
4. **Make changes** with clear, focused commits
5. **Test** your changes
6. **Push** and create a PR targeting `dev`:
   ```bash
   git push -u origin feature/your-feature
   ```
7. Open a PR from your branch to `dev`

### Commit Messages

Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

### Guidelines

- Keep changes focused and small
- UI and UX improvements are welcome
- Vessel intentionally avoids becoming a platform
- If unsure whether something fits, open an issue first

### Development Setup

See the [Development Wiki](https://github.com/VikingOwl91/vessel/wiki/Development) for detailed setup instructions.
