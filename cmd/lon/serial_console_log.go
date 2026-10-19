package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type consoleLogRecord struct {
	Timestamp string `json:"timestamp"`
	Direction string `json:"direction"`
	Port      string `json:"port"`
	Baud      int    `json:"baud"`
	Text      string `json:"text,omitempty"`
	Data      []byte `json:"dataBase64,omitempty"`
	Event     string `json:"event,omitempty"`
}

type consoleLogSession struct {
	queue   chan consoleLogRecord
	done    chan struct{}
	pending map[string][]byte
}

type consoleLogger struct {
	mu       sync.Mutex
	session  *consoleLogSession
	lastDone chan struct{}
	port     string
	baud     int
	report   func(error)
}

func (l *consoleLogger) start(path string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.session != nil {
		return errors.New("logging already active; use /logoff first")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	session := &consoleLogSession{queue: make(chan consoleLogRecord, 256), done: make(chan struct{}), pending: make(map[string][]byte)}
	l.session, l.lastDone = session, session.done
	session.queue <- consoleLogRecord{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Direction: "INFO", Port: l.port, Baud: l.baud, Event: "logging-started"}
	go func() {
		defer close(session.done)
		encoder := json.NewEncoder(file)
		failed := false
		for record := range session.queue {
			if failed {
				continue
			}
			if err := encoder.Encode(record); err != nil {
				failed = true
				l.mu.Lock()
				if l.session == session {
					l.session = nil
					close(session.queue)
				}
				l.mu.Unlock()
				l.report(err)
			}
		}
		if err := file.Close(); err != nil && !failed {
			l.report(err)
		}
	}()
	return nil
}

func (l *consoleLogger) data(direction string, data []byte) {
	l.mu.Lock()
	session := l.session
	if session == nil {
		l.mu.Unlock()
		return
	}
	// Keep incomplete UTF-8 between chunks; the original bytes are always retained.
	remaining := append(session.pending[direction], data...)
	var text strings.Builder
	for len(remaining) > 0 && utf8.FullRune(remaining) {
		r, size := utf8.DecodeRune(remaining)
		text.WriteRune(r)
		remaining = remaining[size:]
	}
	session.pending[direction] = append([]byte(nil), remaining...)
	record := consoleLogRecord{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Direction: direction, Port: l.port, Baud: l.baud, Text: text.String(), Data: append([]byte(nil), data...)}
	select {
	case session.queue <- record:
		l.mu.Unlock()
	default:
		l.session = nil
		close(session.queue)
		l.mu.Unlock()
		l.report(errors.New("disk cannot keep up with serial data"))
	}
}

func (l *consoleLogger) stop() {
	l.mu.Lock()
	if session := l.session; session != nil {
		l.session = nil
		// Do not block on a full queue while holding the mutex.
		select {
		case session.queue <- consoleLogRecord{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Direction: "INFO", Port: l.port, Baud: l.baud, Event: "logging-stopped"}:
		default:
		}
		close(session.queue)
	}
	done := l.lastDone
	l.mu.Unlock()
	if done != nil {
		<-done
	}
}
