package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"go.bug.st/serial"
	"golang.org/x/term"
)

type consoleOptions struct {
	port, ending, log string
	baud              int
	hex               bool
}

func serialConsoleCommand(args []string, input io.Reader, output io.Writer) error {
	opts := consoleOptions{}
	flags := flag.NewFlagSet("serial-console", flag.ContinueOnError)
	flags.SetOutput(output)
	flags.StringVar(&opts.port, "port", "", "Serial port: COM3, /dev/cu.usbmodem..., /dev/ttyACM0")
	flags.IntVar(&opts.baud, "baud", 115200, "Baud rate (8N1, no flow control)")
	flags.StringVar(&opts.ending, "ending", "lf", "Transmit line ending: lf, crlf, cr, none")
	flags.StringVar(&opts.log, "log", "", "Optional JSONL log file (append)")
	flags.BoolVar(&opts.hex, "hex", false, "Display received bytes in HEX")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Fprintln(output, consoleHelp)
			return nil
		}
		return err
	}
	if opts.port == "" || opts.baud < 1 || opts.baud > 4000000 || flags.NArg() != 0 {
		return errors.New("serial-console requires --port PORT and --baud between 1 and 4000000")
	}
	if _, ok := consoleEndings[opts.ending]; !ok {
		return errors.New("--ending must be lf, crlf, cr or none")
	}
	port, err := serial.Open(opts.port, &serial.Mode{BaudRate: opts.baud, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit})
	if err != nil {
		return fmt.Errorf("open %s: %w (check permissions and other applications using the port)", opts.port, err)
	}
	defer port.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	return runSerialConsole(ctx, port, input, output, opts)
}

var consoleEndings = map[string]string{"lf": "\n", "crlf": "\r\n", "cr": "\r", "none": ""}

const consoleHelp = `Type a message and press Enter to send it. Use Backspace, Left and Right to edit.
/help            Show commands
/hex, /text      Select receive display
/ending MODE     Select lf, crlf, cr or none
/log PATH        Start appending RX/TX messages to a JSONL file (spaces allowed)
/logoff          Stop logging and flush the file
/clear           Clear the terminal display
/quit            Disconnect and exit (also Ctrl+C)
Use //text to send a message beginning with /.`

type consoleOutput struct {
	mu             sync.Mutex
	w              io.Writer
	interactive    bool
	manageTerminal bool
	terminalFD     int
	terminalRows   int
	terminalCols   int
	terminalSize   func(int) (int, int, error)
	lastOutputCR   bool
	input          []byte
	cursor         int
}

func (o *consoleOutput) write(data []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.interactive && !o.manageTerminal {
		if err := writeConsoleBytes(o.w, []byte("\r\x1b[2K")); err != nil {
			return err
		}
	}
	if o.manageTerminal {
		if err := o.resizeLocked(); err != nil {
			return err
		}
	}
	if o.interactive {
		// Raw terminal mode disables the usual LF -> CRLF translation. Keep
		// device lines aligned with the left edge, including split CRLF reads.
		formatted := make([]byte, 0, len(data))
		for _, value := range data {
			if value == '\n' && !o.lastOutputCR {
				formatted = append(formatted, '\r')
			}
			formatted = append(formatted, value)
			o.lastOutputCR = value == '\r'
		}
		data = formatted
	}
	if err := writeConsoleBytes(o.w, data); err != nil {
		return err
	}
	if !o.interactive || o.manageTerminal {
		// The reserved input row is outside the receive scroll region. Redrawing
		// it between reads would reset the terminal's pending automatic wrap when
		// a read ends exactly at the right edge of the window.
		return nil
	}
	if !o.manageTerminal && len(data) > 0 && data[len(data)-1] != '\n' && data[len(data)-1] != '\r' {
		if err := writeConsoleBytes(o.w, []byte("\r\n")); err != nil {
			return err
		}
	}
	return o.renderInputLocked()
}

func (o *consoleOutput) beginInteractive(fd int) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.manageTerminal = true
	o.terminalFD = fd
	if o.terminalSize == nil {
		o.terminalSize = term.GetSize
	}
	if err := writeConsoleBytes(o.w, []byte("\x1b[?7h")); err != nil {
		return err
	}
	if err := o.refreshTerminalLocked(); err != nil {
		return err
	}
	return o.renderInputLocked()
}

func (o *consoleOutput) endInteractive() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.manageTerminal {
		return nil
	}
	if err := writeConsoleBytes(o.w, []byte("\x1b[r")); err != nil {
		return err
	}
	if o.terminalRows > 0 {
		if err := writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[%d;1H\r\x1b[2K\r\n", o.terminalRows))); err != nil {
			return err
		}
	}
	o.manageTerminal = false
	return nil
}

func (o *consoleOutput) refreshTerminalLocked() error {
	if !o.manageTerminal {
		return nil
	}
	cols, rows, err := o.terminalSize(o.terminalFD)
	if err != nil {
		return fmt.Errorf("read serial console terminal size: %w", err)
	}
	if cols < 1 || rows < 2 {
		// A hidden or minimized terminal can temporarily report no usable area.
		return nil
	}
	if rows == o.terminalRows && cols == o.terminalCols {
		return nil
	}
	previousRows := o.terminalRows
	o.terminalRows = rows
	o.terminalCols = cols
	if previousRows == 0 {
		return writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[1;%dr\x1b[%d;1H", rows-1, rows-1)))
	}
	// Keep the receive cursor where the terminal's own reflow placed it.
	// Resetting it to column one on resize overwrites an unfinished RX line.
	if rows != previousRows {
		clear := ""
		if previousRows < rows {
			clear = fmt.Sprintf("\x1b[%d;1H\x1b[2K", previousRows)
		}
		return writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[s%s\x1b[1;%dr\x1b[u", clear, rows-1)))
	}
	return nil
}

func (o *consoleOutput) resize() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.resizeLocked()
}

func (o *consoleOutput) resizeLocked() error {
	cols, rows := o.terminalCols, o.terminalRows
	if err := o.refreshTerminalLocked(); err != nil {
		return err
	}
	if cols == o.terminalCols && rows == o.terminalRows {
		return nil
	}
	return o.renderInputLocked()
}

func (o *consoleOutput) clear() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if err := writeConsoleBytes(o.w, []byte("\x1b[2J\x1b[H")); err != nil {
		return err
	}
	return o.renderInputLocked()
}

func (o *consoleOutput) setInput(input []byte, cursor int) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.input = append(o.input[:0], input...)
	o.cursor = cursor
	return o.renderInputLocked()
}

func (o *consoleOutput) submitInput(input []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.manageTerminal {
		if err := o.refreshTerminalLocked(); err != nil {
			return err
		}
	} else if err := writeConsoleBytes(o.w, []byte("\r\x1b[2K")); err != nil {
		return err
	}
	if err := writeConsoleBytes(o.w, []byte("\r\n> ")); err != nil {
		return err
	}
	if err := writeConsoleBytes(o.w, input); err != nil {
		return err
	}
	if err := writeConsoleBytes(o.w, []byte("\r\n")); err != nil {
		return err
	}
	o.input = o.input[:0]
	o.cursor = 0
	return o.renderInputLocked()
}

func (o *consoleOutput) renderInputLocked() error {
	if !o.interactive {
		return nil
	}
	if o.manageTerminal {
		if err := o.refreshTerminalLocked(); err != nil {
			return err
		}
		if o.terminalRows == 0 {
			return nil
		}
		// Leave the last column unused so drawing the prompt never wraps into
		// the receive area. Scroll the draft horizontally to keep the cursor visible.
		prompt, draft, trailingRunes := consoleInputViewport(o.input, o.cursor, o.terminalCols)
		if err := writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[s\x1b[%d;1H\x1b[2K%s", o.terminalRows, prompt))); err != nil {
			return err
		}
		if err := writeConsoleBytes(o.w, draft); err != nil {
			return err
		}
		if trailingRunes > 0 {
			if err := writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[%dD", trailingRunes))); err != nil {
				return err
			}
		}
		return writeConsoleBytes(o.w, []byte("\x1b[u"))
	}
	if err := writeConsoleBytes(o.w, []byte("\r\x1b[2K> ")); err != nil {
		return err
	}
	if err := writeConsoleBytes(o.w, o.input); err != nil {
		return err
	}
	trailingRunes := utf8.RuneCount(o.input[o.cursor:])
	if trailingRunes > 0 {
		return writeConsoleBytes(o.w, []byte(fmt.Sprintf("\x1b[%dD", trailingRunes)))
	}
	return nil
}

func consoleInputViewport(input []byte, cursor, columns int) (string, []byte, int) {
	prompt := "> "
	available := max(0, columns-1)
	if available < len(prompt) {
		return prompt[:available], nil, 0
	}
	available -= len(prompt)
	start := cursor
	for count := 0; start > 0 && count < available; count++ {
		_, size := utf8.DecodeLastRune(input[:start])
		start -= size
	}
	end := start
	for count := 0; end < len(input) && count < available; count++ {
		_, size := utf8.DecodeRune(input[end:])
		end += size
	}
	return prompt, input[start:end], utf8.RuneCount(input[cursor:end])
}

func writeConsoleBytes(w io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := w.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

func (o *consoleOutput) notice(format string, args ...any) {
	_ = o.write([]byte(fmt.Sprintf("\r\n[Dauhuniec] "+format+"\r\n", args...)))
}

func runSerialConsole(ctx context.Context, port io.ReadWriter, input io.Reader, output io.Writer, opts consoleOptions) error {
	inputFile, inputIsFile := input.(*os.File)
	outputFile, outputIsFile := output.(*os.File)
	if inputIsFile && outputIsFile && term.IsTerminal(int(inputFile.Fd())) && term.IsTerminal(int(outputFile.Fd())) {
		return runInteractiveSerialConsole(ctx, port, inputFile, outputFile, opts)
	}
	return runSerialConsoleWithOutput(ctx, port, input, &consoleOutput{w: output}, opts)
}

func runInteractiveSerialConsole(ctx context.Context, port io.ReadWriter, input, output *os.File, opts consoleOptions) (result error) {
	state, err := term.MakeRaw(int(input.Fd()))
	if err != nil {
		return fmt.Errorf("enable serial console input: %w", err)
	}
	defer func() {
		if err := term.Restore(int(input.Fd()), state); result == nil && err != nil {
			result = fmt.Errorf("restore terminal input: %w", err)
		}
	}()

	inputReader, inputWriter := io.Pipe()
	defer inputReader.Close()
	defer inputWriter.Close()
	out := &consoleOutput{w: output, interactive: true}
	if err := out.beginInteractive(int(output.Fd())); err != nil {
		return err
	}
	defer func() {
		if err := out.endInteractive(); result == nil && err != nil {
			result = err
		}
	}()
	resizeCtx, stopResize := context.WithCancel(ctx)
	resizeDone := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-resizeCtx.Done():
				resizeDone <- nil
				return
			case <-ticker.C:
				if err := out.resize(); err != nil {
					resizeDone <- err
					stopResize()
					return
				}
			}
		}
	}()
	defer func() {
		stopResize()
		if err := <-resizeDone; result == nil && err != nil {
			result = err
		}
	}()
	go func() {
		err := readConsoleInput(input, out, inputWriter)
		if err != nil {
			_ = inputWriter.CloseWithError(err)
		} else {
			_ = inputWriter.Close()
		}
	}()
	return runSerialConsoleWithOutput(resizeCtx, port, inputReader, out, opts)
}

func readConsoleInput(input io.Reader, output *consoleOutput, submitted io.Writer) error {
	reader := bufio.NewReader(input)
	line := make([]byte, 0, 128)
	cursor := 0
	lastWasCR := false
	for {
		value, err := reader.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return fmt.Errorf("read console input: %w", err)
		}
		if lastWasCR && value == '\n' {
			lastWasCR = false
			continue
		}
		lastWasCR = false
		switch value {
		case '\r', '\n':
			if err := output.submitInput(line); err != nil {
				return err
			}
			if _, err := io.WriteString(submitted, string(line)+"\n"); err != nil {
				return err
			}
			line = line[:0]
			cursor = 0
			lastWasCR = value == '\r'
		case 3:
			line = []byte("/quit")
			cursor = len(line)
			if err := output.submitInput(line); err != nil {
				return err
			}
			_, err := io.WriteString(submitted, "/quit\n")
			return err
		case 4:
			return nil
		case 8, 127:
			if cursor > 0 {
				_, size := utf8.DecodeLastRune(line[:cursor])
				copy(line[cursor-size:], line[cursor:])
				line = line[:len(line)-size]
				cursor -= size
			}
		case 21:
			line = line[:0]
			cursor = 0
		case 27:
			sequence, err := readConsoleEscape(reader)
			if err != nil {
				return err
			}
			switch sequence {
			case "[D", "OD":
				if cursor > 0 {
					_, size := utf8.DecodeLastRune(line[:cursor])
					cursor -= size
				}
			case "[C", "OC":
				if cursor < len(line) {
					_, size := utf8.DecodeRune(line[cursor:])
					cursor += size
				}
			case "[H", "[1~", "OH":
				cursor = 0
			case "[F", "[4~", "OF":
				cursor = len(line)
			case "[3~":
				if cursor < len(line) {
					_, size := utf8.DecodeRune(line[cursor:])
					copy(line[cursor:], line[cursor+size:])
					line = line[:len(line)-size]
				}
			}
		default:
			if value >= 32 && value != 127 {
				line = append(line, 0)
				copy(line[cursor+1:], line[cursor:])
				line[cursor] = value
				cursor++
			}
		}
		if err := output.setInput(line, cursor); err != nil {
			return err
		}
	}
}

func readConsoleEscape(reader *bufio.Reader) (string, error) {
	value, err := reader.ReadByte()
	if err != nil {
		return "", fmt.Errorf("read console escape sequence: %w", err)
	}
	if value != '[' && value != 'O' {
		return "", nil
	}
	sequence := []byte{value}
	for len(sequence) < 4 {
		value, err = reader.ReadByte()
		if err != nil {
			return "", fmt.Errorf("read console escape sequence: %w", err)
		}
		sequence = append(sequence, value)
		if value >= 0x40 && value <= 0x7e {
			break
		}
	}
	return string(sequence), nil
}

func runSerialConsoleWithOutput(ctx context.Context, port io.ReadWriter, input io.Reader, out *consoleOutput, opts consoleOptions) error {
	log := &consoleLogger{port: opts.port, baud: opts.baud, report: func(err error) { out.notice("Logging stopped: %v", err) }}
	defer log.stop()
	if out.interactive {
		if err := out.setInput(nil, 0); err != nil {
			return err
		}
	}
	if opts.log != "" {
		if err := log.start(opts.log); err != nil {
			return fmt.Errorf("start log: %w", err)
		}
		out.notice("Logging to %s", opts.log)
	}
	var hex atomic.Bool
	hex.Store(opts.hex)
	ending := consoleEndings[opts.ending]
	out.notice("Serial Monitor · %s · %d baud · 8N1", opts.port, opts.baud)
	out.notice("Type /help for commands. Logging is %s.", map[bool]string{true: "on", false: "off"}[opts.log != ""])
	done := make(chan error, 2)
	stopped := make(chan struct{})
	defer close(stopped)
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, err := port.Read(buffer)
			select {
			case <-stopped:
				return
			default:
			}
			if n > 0 {
				log.data("RX", buffer[:n])
				data := buffer[:n]
				if hex.Load() {
					data = []byte(fmt.Sprintf("% X\r\n", data))
				}
				if writeErr := out.write(data); writeErr != nil {
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
	go func() {
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 4096), 256*1024)
		for scanner.Scan() {
			select {
			case <-stopped:
				return
			default:
			}
			line := scanner.Text()
			if strings.HasPrefix(line, "/") && !strings.HasPrefix(line, "//") {
				command, value, _ := strings.Cut(line, " ")
				value = strings.TrimSpace(value)
				switch command {
				case "/quit":
					done <- nil
					return
				case "/help":
					out.notice("%s", consoleHelp)
				case "/hex":
					hex.Store(true)
					out.notice("HEX display")
				case "/text":
					hex.Store(false)
					out.notice("UTF-8 display")
				case "/clear":
					_ = out.clear()
				case "/ending":
					if next, ok := consoleEndings[value]; ok {
						ending = next
						out.notice("Line ending: %s", value)
					} else {
						out.notice("Use /ending lf|crlf|cr|none")
					}
				case "/log":
					if value == "" {
						out.notice("Use /log PATH")
						continue
					}
					if err := log.start(value); err != nil {
						out.notice("Cannot start log: %v", err)
					} else {
						out.notice("Logging to %s", value)
					}
				case "/logoff":
					log.stop()
					out.notice("Logging off")
				default:
					out.notice("Unknown command. Use /help, or // to send a leading slash.")
				}
				continue
			}
			if strings.HasPrefix(line, "//") {
				line = line[1:]
			}
			data := []byte(line + ending)
			for len(data) > 0 {
				n, err := port.Write(data)
				if n > 0 {
					log.data("TX", data[:n])
					data = data[n:]
				}
				if err != nil {
					done <- fmt.Errorf("send: %w", err)
					return
				}
				if n == 0 {
					done <- io.ErrShortWrite
					return
				}
			}
		}
		done <- scanner.Err()
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return nil
	}
}
