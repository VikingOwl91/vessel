package llm

// BackendFactory creates Backend instances from configuration.
// The concrete implementation is provided externally to avoid import cycles.
type BackendFactory interface {
	Create(cfg *BackendConfig) (Backend, error)
}
