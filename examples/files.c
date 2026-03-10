/* files — file I/O via the kernel's virtual filesystem */
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>

int main(void) {
    const char *path = "/tmp/test.txt";
    const char *msg = "Hello from a file!\n";

    /* Write to a file */
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
        perror("open for write");
        return 1;
    }
    write(fd, msg, strlen(msg));
    close(fd);
    printf("Wrote %zu bytes to %s\n", strlen(msg), path);

    /* Read it back */
    fd = open(path, O_RDONLY);
    if (fd < 0) {
        perror("open for read");
        return 1;
    }
    char buf[128] = {0};
    int n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    printf("Read back %d bytes: %s", n, buf);

    /* Seek */
    fd = open(path, O_RDONLY);
    lseek(fd, 6, SEEK_SET);
    n = read(fd, buf, 4);
    buf[n] = '\0';
    close(fd);
    printf("After seek(6): \"%s\"\n", buf);

    /* Unlink */
    unlink(path);
    printf("Unlinked %s\n", path);

    return 0;
}
