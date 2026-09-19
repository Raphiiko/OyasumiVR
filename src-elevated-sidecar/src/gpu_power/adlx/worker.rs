use super::{device::Device, interface::GpuTuningServices};
use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError};

use adlx::helper::AdlxHelper;
use std::{sync::mpsc, thread};

enum Command {
    GetDevices(mpsc::Sender<Vec<NvmlDevice>>),
    SetPowerLimit {
        uuid: String,
        encoded_limit: u32,
        tx: mpsc::Sender<Result<bool, NvmlSetPowerManagementLimitError>>,
    },
}

pub(super) struct Worker {
    tx: mpsc::Sender<Command>,
}

struct Runtime {
    // Drop interfaces and services before their owning SDK helper.
    devices: Vec<Device>,
    _tuning_services: GpuTuningServices,
    _helper: AdlxHelper,
}

impl Worker {
    /// Starts the thread that owns every ADLX interface and waits for initialization to finish.
    /// Thread creation, SDK initialization, or startup-channel failure returns an error.
    pub(super) fn spawn() -> Result<Self, String> {
        let (command_tx, command_rx) = mpsc::channel();
        let (init_tx, init_rx) = mpsc::channel();

        thread::Builder::new()
            .name("oyasumi-adlx-worker".to_owned())
            .spawn(move || {
                let runtime = match Runtime::new() {
                    Ok(runtime) => runtime,
                    Err(err) => {
                        let _ = init_tx.send(Err(err));
                        return;
                    }
                };

                let _ = init_tx.send(Ok(()));
                runtime.run(command_rx);
            })
            .map_err(|err| err.to_string())?;

        init_rx.recv().map_err(|err| err.to_string())??;
        Ok(Self { tx: command_tx })
    }

    /// Blocks for a copy of the worker's cached readings; a closed channel returns an error.
    pub(super) fn get_devices(&self) -> Result<Vec<NvmlDevice>, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Command::GetDevices(tx))
            .map_err(|_| "worker channel closed".to_owned())?;
        rx.recv().map_err(|err| err.to_string())
    }

    /// Blocks for a driver write using `(percent_offset + 100) * 1000` on the ADLX thread.
    /// Channel failures map to `DeviceAccessError`; device errors are returned unchanged.
    pub(super) fn set_power_limit(
        &self,
        uuid: String,
        encoded_limit: u32,
    ) -> Result<bool, NvmlSetPowerManagementLimitError> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Command::SetPowerLimit {
                uuid,
                encoded_limit,
                tx,
            })
            .map_err(|_| NvmlSetPowerManagementLimitError::DeviceAccessError)?;

        rx.recv()
            .map_err(|_| NvmlSetPowerManagementLimitError::DeviceAccessError)?
    }
}

impl Runtime {
    /// Creates the SDK helper and discovers devices on the thread that will run this runtime.
    fn new() -> Result<Self, String> {
        let helper = AdlxHelper::new().map_err(|err| err.to_string())?;
        let tuning_services =
            GpuTuningServices::from_system(helper.system()).map_err(|err| err.to_string())?;
        let devices = Device::discover(&helper, &tuning_services);

        Ok(Self {
            devices,
            _tuning_services: tuning_services,
            _helper: helper,
        })
    }

    /// Serializes cache reads and driver writes until all command senders are dropped.
    fn run(mut self, command_rx: mpsc::Receiver<Command>) {
        while let Ok(command) = command_rx.recv() {
            match command {
                Command::GetDevices(tx) => {
                    let devices = self
                        .devices
                        .iter()
                        .map(|device| device.info().clone())
                        .collect();
                    let _ = tx.send(devices);
                }
                Command::SetPowerLimit {
                    uuid,
                    encoded_limit,
                    tx,
                } => {
                    let result = self
                        .devices
                        .iter_mut()
                        .find(|device| device.uuid() == uuid)
                        .ok_or(NvmlSetPowerManagementLimitError::DeviceAccessError)
                        .and_then(|device| device.set_power_limit(encoded_limit));
                    let _ = tx.send(result);
                }
            }
        }
    }
}
