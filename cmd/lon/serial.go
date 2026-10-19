package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"sort"

	"go.bug.st/serial"
)

type serialEvent struct {
	Type string `json:"type"`
	Data []byte `json:"data,omitempty"`
}

func serialCommand(action string, args []string, input io.Reader, output io.Writer) error {
	if action == "serial-list" {
		if len(args) != 0 {
			return errors.New("serial-list takes no arguments")
		}
		ports, err := serial.GetPortsList()
		if err != nil {
			return fmt.Errorf("list serial ports: %w", err)
		}
		if ports == nil {
			ports = []string{}
		}
		sort.Strings(ports)
		return json.NewEncoder(output).Encode(ports)
	}
	flags := flag.NewFlagSet("serial-monitor", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	portName := flags.String("port", "", "Serial port path")
	baud := flags.Int("baud", 115200, "Baud rate")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *portName == "" || *baud <= 0 || *baud > 4000000 || flags.NArg() != 0 {
		return errors.New("serial-monitor requires --port PORT and --baud between 1 and 4000000")
	}
	port, err := serial.Open(*portName, &serial.Mode{BaudRate: *baud, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit})
	if err != nil {
		return fmt.Errorf("open %s: %w (check permissions and whether another monitor is using the port)", *portName, err)
	}
	defer port.Close()
	return bridgeSerial(port, input, output)
}

// Only this goroutine writes JSON. Stdin carries raw transmit bytes; EOF releases the port.
func bridgeSerial(port io.ReadWriter, input io.Reader, output io.Writer) error {
	encoder := json.NewEncoder(output)
	if err := encoder.Encode(serialEvent{Type: "ready"}); err != nil {
		return err
	}
	done := make(chan error, 2)
	go func() {
		_, err := io.Copy(port, input)
		done <- err
	}()
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, err := port.Read(buffer)
			if n > 0 {
				if writeErr := encoder.Encode(serialEvent{Type: "data", Data: buffer[:n]}); writeErr != nil {
					done <- writeErr
					return
				}
			}
			if err != nil || n == 0 {
				if err == nil {
					err = io.EOF
				}
				done <- fmt.Errorf("serial port disconnected: %w", err)
				return
			}
		}
	}()
	return <-done
}
