package main

import (
	"flag"
	"fmt"
	"os"
	"syscall"
	"time"

	"./slog"
	"code.google.com/p/winsvc/debug"
	"code.google.com/p/winsvc/eventlog"
	"code.google.com/p/winsvc/mgr"
	"code.google.com/p/winsvc/registry"
	"code.google.com/p/winsvc/svc"
)

var win_service_command = flag.String("winsvc", "", "For Windows Service, can be install, remove, start, stop")

func init() {
	mains = append(mains, win_service_main)
}

func win_service_main() {
	const svcName = "scollector"
	var err error
	switch *win_service_command {
	case "install":
		err = installService(svcName, "Stack Exchange's Metric Collection Agent")
	case "remove":
		err = removeService(svcName)
	case "start":
		err = startService(svcName)
	case "stop":
		err = controlService(svcName, svc.Stop, svc.Stopped)
	case "":
		isIntSess, err := svc.IsAnInteractiveSession()
		if err != nil {
			slog.Fatalf("failed to determine if we are running in an interactive session: %v", err)
		}
		if !isIntSess {
			go runService(svcName, false)
		}
		return
	default:
		slog.Fatalf("unknown winsvc command: %v", *win_service_command)
	}
	if err != nil {
		slog.Fatalf("failed to %s %s: %v", *win_service_command, svcName, err)
	}
	os.Exit(0)
}

func installService(name, desc string) error {
	exepath, err := exePath()
	if err != nil {
		return err
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err == nil {
		s.Close()
		return fmt.Errorf("service %s already exists", name)
	}
	s, err = m.CreateService(name, exepath, mgr.Config{DisplayName: name,
		StartType:   mgr.StartAutomatic,
		Description: desc})
	if err != nil {
		return err
	}
	defer s.Close()
	err = eventlog.InstallAsEventCreate(name, eventlog.Error|eventlog.Warning|eventlog.Info)
	if err != nil {
		s.Delete()
		return fmt.Errorf("SetupEventLogSource() failed: %s", err)
	}
	return nil
}

func removeService(name string) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return fmt.Errorf("service %s is not installed", name)
	}
	defer s.Close()
	err = s.Delete()
	if err != nil {
		return err
	}
	err = eventlog.Remove(name)
	if err != nil {
		return fmt.Errorf("RemoveEventLogSource() failed: %s", err)
	}
	return nil
}

func startService(name string) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return fmt.Errorf("could not access service: %v", err)
	}
	defer s.Close()
	err = s.Start(nil)
	if err != nil {
		return fmt.Errorf("could not start service: %v", err)
	}
	return nil
}

func controlService(name string, c svc.Cmd, to svc.State) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(name)
	if err != nil {
		return fmt.Errorf("could not access service: %v", err)
	}
	defer s.Close()
	status, err := s.Control(c)
	if err != nil {
		return fmt.Errorf("could not send control=%d: %v", c, err)
	}
	timeout := time.Now().Add(10 * time.Second)
	for status.State != to {
		if timeout.Before(time.Now()) {
			return fmt.Errorf("timeout waiting for service to go to state=%d", to)
		}
		time.Sleep(300 * time.Millisecond)
		status, err = s.Query()
		if err != nil {
			return fmt.Errorf("could not retrieve service status: %v", err)
		}
	}
	return nil
}

type s struct{}

func (m *s) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown
	changes <- svc.Status{State: svc.StartPending}
	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
loop:
	for c := range r {
		switch c.Cmd {
		case svc.Interrogate:
			changes <- c.CurrentStatus
		case svc.Stop, svc.Shutdown:
			break loop
		default:
			slog.Errorf("unexpected control request #%d", c)
		}
	}
	changes <- svc.Status{State: svc.StopPending}
	return
}

func runService(name string, isDebug bool) {
	errFix := fixEventMessageFile(name) //Temp fix. Remove after a few weeks.
	if errFix != nil {
		slog.Errorf("%s fixEventMessageFile failed: %v", name, errFix)
		return
	}
	if isDebug {
		slog.SetEventLog(debug.New(name), 1)
	} else {
		elog, err := eventlog.Open(name)
		if err != nil {
			return
		}
		slog.SetEventLog(elog, 1)
		defer elog.Close()
	}
	slog.Infof("starting %s service version %v (%v)", name, VersionDate, VersionID)
	run := svc.Run
	if isDebug {
		run = debug.Run
	}
	err := run(name, &s{})
	if err != nil {
		slog.Errorf("%s service failed: %v", name, err)
		return
	}
	slog.Infof("%s service stopped", name)
	os.Exit(0)
}

// This is a temporary method to fix an issue with the EventMessageFile.
// See http://stackoverflow.com/questions/29130586 for details.
func fixEventMessageFile(src string) error {
	const addKeyName = `SYSTEM\CurrentControlSet\Services\EventLog\Application`
	appkey, err := registry.OpenKey(syscall.HKEY_LOCAL_MACHINE, addKeyName)
	if err != nil {
		return err
	}
	defer appkey.Close()
	sk, alreadyExist, err := appkey.CreateSubKey(src)
	if err != nil {
		return err
	}
	defer sk.Close()
	if alreadyExist {
		// Update REG_SZ key with expanded value for %systemroot% variable.
		err = sk.SetString("EventMessageFile", os.ExpandEnv("${systemroot}\\System32\\EventCreate.exe"))
		if err != nil {
			return err
		}
	}
	return nil
}
