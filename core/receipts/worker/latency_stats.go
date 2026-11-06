package main

// Mini-Demo-Worker: liest JSON {latencies_ms:[...]} von stdin, liefert Stats-JSON.
import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
)

type input struct{ LatenciesMs []float64 `json:"latencies_ms"` }

func main() {
	raw, _ := io.ReadAll(os.Stdin)
	var in input
	_ = json.Unmarshal(raw, &in)
	v := append([]float64{}, in.LatenciesMs...)
	sort.Float64s(v)
	var sum float64
	for _, x := range v {
		sum += x
	}
	n := len(v)
	out := map[string]any{"packages": n}
	if n > 0 {
		out["mean_ms"] = sum / float64(n)
		out["p50_ms"] = v[n/2]
		out["max_ms"] = v[n-1]
	}
	b, _ := json.Marshal(out)
	fmt.Println(string(b))
}
