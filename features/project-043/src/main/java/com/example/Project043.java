package com.example;

public class Project043 {
    public static void main(String[] args) {
        System.out.println("Hello from project-043");
        new Project042().doSomething();
        new Project008().doSomething();
    }

    public void doSomething() {
        System.out.println("project-043 doing something");
    }
}
