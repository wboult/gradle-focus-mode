package com.example;

public class Project011 {
    public static void main(String[] args) {
        System.out.println("Hello from project-011");
        new Project007().doSomething();
        new Project006().doSomething();
    }

    public void doSomething() {
        System.out.println("project-011 doing something");
    }
}
