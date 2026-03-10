/* dirs — directory operations */
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>

int main(void) {
    /* Create nested directories */
    mkdir("/tmp/testdir", 0755);
    mkdir("/tmp/testdir/sub", 0755);
    printf("Created /tmp/testdir/sub\n");

    /* Create files in the directory */
    int fd = open("/tmp/testdir/file1.txt", O_WRONLY | O_CREAT, 0644);
    write(fd, "one\n", 4);
    close(fd);

    fd = open("/tmp/testdir/file2.txt", O_WRONLY | O_CREAT, 0644);
    write(fd, "two\n", 4);
    close(fd);
    printf("Created 2 files\n");

    /* Stat a file */
    struct stat st;
    if (stat("/tmp/testdir/file1.txt", &st) == 0) {
        printf("file1.txt: size=%llu mode=%o\n",
               (unsigned long long)st.st_size, st.st_mode & 0777);
    }

    /* getcwd */
    char cwd[256];
    if (getcwd(cwd, sizeof(cwd)))
        printf("cwd: %s\n", cwd);

    /* chdir */
    chdir("/tmp/testdir");
    if (getcwd(cwd, sizeof(cwd)))
        printf("after chdir: %s\n", cwd);

    /* Cleanup */
    unlink("/tmp/testdir/file1.txt");
    unlink("/tmp/testdir/file2.txt");
    rmdir("/tmp/testdir/sub");
    rmdir("/tmp/testdir");
    printf("Cleaned up.\n");

    return 0;
}
