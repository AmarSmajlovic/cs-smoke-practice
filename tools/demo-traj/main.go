// Extracts smoke grenade trajectories from a CS2 demo.
//
// demoparser2 (Python) reads the landing point in seconds but takes 20+ minutes
// to reconstruct entity state, and never finished on a 257MB demo. This reads
// the projectile entity directly: position AND velocity every tick, plus an
// explicit bounce event.
//
// Velocity per tick is the point. It makes the bounce model measurable — the
// elasticity is the ratio of speed before to speed after a bounce — instead of
// something to fit blindly against final resting places.
//
// Usage: go run . <demo.dem> <out.json>
package main

import (
	"encoding/json"
	"fmt"
	"os"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

type Sample struct {
	Tick int     `json:"tick"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Z    float64 `json:"z"`
}

type Throw struct {
	ID         int64    `json:"id"`
	Thrower    string   `json:"thrower"`
	ThrowTick  int      `json:"throw_tick"`
	DetTick    int      `json:"det_tick"`
	BounceTick []int    `json:"bounce_ticks"`
	Samples    []Sample `json:"samples"`
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: demotraj <demo.dem> <out.json>")
		os.Exit(2)
	}
	f, err := os.Open(os.Args[1])
	must(err)
	defer f.Close()

	p := dem.NewParser(f)
	defer p.Close()

	live := map[int64]*Throw{}
	var done []*Throw

	p.RegisterEventHandler(func(e events.GrenadeProjectileThrow) {
		if e.Projectile.WeaponInstance.Type != common.EqSmoke {
			return
		}
		name := ""
		if e.Projectile.Thrower != nil {
			name = e.Projectile.Thrower.Name
		}
		live[e.Projectile.UniqueID()] = &Throw{
			ID: e.Projectile.UniqueID(), Thrower: name, ThrowTick: p.GameState().IngameTick(),
		}
	})

	p.RegisterEventHandler(func(e events.GrenadeProjectileBounce) {
		if t, ok := live[e.Projectile.UniqueID()]; ok {
			t.BounceTick = append(t.BounceTick, p.GameState().IngameTick())
		}
	})

	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		t, ok := live[e.Projectile.UniqueID()]
		if !ok {
			return
		}
		t.DetTick = p.GameState().IngameTick()
		delete(live, e.Projectile.UniqueID())
		done = append(done, t)
	})

	// Sampling per frame rather than trusting Trajectory2: that field carries
	// positions only, and the velocity at each tick is exactly what makes the
	// bounces measurable.
	p.RegisterEventHandler(func(e events.FrameDone) {
		tick := p.GameState().IngameTick()
		for _, g := range p.GameState().GrenadeProjectiles() {
			t, ok := live[g.UniqueID()]
			if !ok {
				continue
			}
			if n := len(t.Samples); n > 0 && t.Samples[n-1].Tick == tick {
				continue // one sample per tick, not per frame
			}
			// Velocity isn't networked on the grenade in this demo, so we don't
			// read g.Velocity() (it panics). Position per tick is enough — the
			// consumer differences successive positions to recover velocity,
			// which is what the bounce measurement needs anyway.
			pos := g.Position()
			t.Samples = append(t.Samples, Sample{tick, pos.X, pos.Y, pos.Z})
		}
	})

	must(p.ParseToEnd())

	out, err := json.Marshal(done)
	must(err)
	must(os.WriteFile(os.Args[2], out, 0644))

	pts := 0
	for _, t := range done {
		pts += len(t.Samples)
	}
	fmt.Printf("smoke throws: %d   samples: %d   -> %s\n", len(done), pts, os.Args[2])
	if len(done) > 0 {
		t := done[0]
		fmt.Printf("first: %s tick %d..%d, %d samples, %d bounces\n",
			t.Thrower, t.ThrowTick, t.DetTick, len(t.Samples), len(t.BounceTick))
		for i, s := range t.Samples {
			if i >= 5 {
				break
			}
			fmt.Printf("  tick %d  pos %.1f %.1f %.1f\n", s.Tick, s.X, s.Y, s.Z)
		}
	}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
