package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"testing"
	"time"
)

func TestSerialOptions(t *testing.T) {
	for _, args := range [][]string{
		nil, {"--port", "COM3", "--baud", "0"}, {"--port", "COM3", "--baud", "4000001"},
		{"--port", "COM3", "--baud", "abc"}, {"--port", "COM3", "extra"}, {"--unknown"},
	} {
		if err := serialCommand("serial-monitor", args, bytes.NewReader(nil), io.Discard); err == nil {
			t.Fatalf("accepted invalid arguments: %v", args)
		}
	}
	if err := serialCommand("serial-list", []string{"unexpected"}, bytes.NewReader(nil), io.Discard); err == nil {
		t.Fatal("serial-list accepted arguments")
	}
}

func TestSerialBridge(t *testing.T) {
	port, device := net.Pipe()
	defer port.Close()
	defer device.Close()
	device.SetDeadline(time.Now().Add(5 * time.Second))
	input, transmit := io.Pipe()
	defer input.Close()
	defer transmit.Close()
	output, events := io.Pipe()
	defer output.Close()
	defer events.Close()
	done := make(chan error, 1)
	go func() { done <- bridgeSerial(port, input, events) }()
	decoder := json.NewDecoder(output)
	var event serialEvent
	if err := decoder.Decode(&event); err != nil || event.Type != "ready" {
		t.Fatalf("missing ready event: %+v, %v", event, err)
	}
	// Raw binary bytes survive JSON framing, including NUL, newlines and invalid UTF-8.
	received := []byte{0, 255, 13, 10, 0xd0, 0x9f}
	go device.Write(received)
	if err := decoder.Decode(&event); err != nil || event.Type != "data" || !bytes.Equal(event.Data, received) {
		t.Fatalf("received data corrupted: %+v, %v", event, err)
	}
	sent := []byte("hello\r\n")
	go transmit.Write(sent)
	actual := make([]byte, len(sent))
	if _, err := io.ReadFull(device, actual); err != nil || !bytes.Equal(actual, sent) {
		t.Fatalf("transmitted data corrupted: %q, %v", actual, err)
	}
	transmit.Close()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stdin EOF did not stop the monitor")
	}
}
