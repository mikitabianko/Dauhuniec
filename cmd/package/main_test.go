package main

import (
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

func TestBuildTargetsKeepsWorkersBusyAndManifestOrdered(t *testing.T) {
	targets := []target{{"slow", "first"}, {"fast", "second"}, {"next", "third"}}
	firstStarted := make(chan struct{})
	thirdStarted := make(chan struct{})
	var active, peak atomic.Int32
	lines, err := buildTargets(targets, 2, func(target target) (string, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		switch target.os {
		case "slow":
			close(firstStarted)
			select {
			case <-thirdStarted:
			case <-time.After(5 * time.Second):
				return "", errors.New("idle worker did not start the next target")
			}
		case "fast":
			<-firstStarted
		case "next":
			close(thirdStarted)
		}
		return target.arch, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"first", "second", "third"}; !reflect.DeepEqual(lines, want) {
		t.Fatalf("manifest order: got %v, want %v", lines, want)
	}
	if peak.Load() != 2 {
		t.Fatalf("expected two concurrent workers, got %d", peak.Load())
	}
}

func TestBuildTargetsReportsFailure(t *testing.T) {
	want := errors.New("compiler failed")
	_, err := buildTargets([]target{{"linux", "amd64"}}, 10, func(target) (string, error) {
		return "", want
	})
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
	if _, err := buildTargets(nil, 0, nil); err == nil {
		t.Fatal("zero workers should be rejected")
	}
}
