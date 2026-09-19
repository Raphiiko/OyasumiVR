FROM archlinux:base-devel@sha256:84cd9ef000b3cff245ec028e87965b84724f4bf1cc63fc2741ba927b88515ed6
RUN pacman-key --init && pacman-key --populate archlinux && pacman -Syu --noconfirm --needed systemd openssh python
RUN systemctl mask systemd-firstboot.service
ENV container=docker
COPY seed.py prepare-arch-guest.sh check-guest.sh /opt/simlab/
STOPSIGNAL SIGRTMIN+3
CMD ["/usr/lib/systemd/systemd"]
